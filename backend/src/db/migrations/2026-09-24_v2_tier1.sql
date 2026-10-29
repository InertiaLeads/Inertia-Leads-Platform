-- =====================================================================================
-- Migration: V2 Tier 1 — Open/Click Tracking, Unified Inbox (IMAP), AI Reply
--            Classification, Behaviour-Based Smart Sequences
-- Date: 2026-09-24
--
-- Run on BOTH dev and production Supabase (SQL Editor) BEFORE deploying the backend.
-- Idempotent — safe to run more than once (create-if-not-exists / add-column-if-not-exists /
-- drop-policy-if-exists + create).
--
-- Conventions (same as schema.sql):
--   * Every table has RLS enabled. Owners get SELECT only. ALL writes go through the
--     service-role backend (background jobs + API), which bypasses RLS. Owner writes are
--     deliberately NOT granted on credential/engagement tables so a user can't forge
--     engagement data or tamper with credentials from the browser anon key.
--   * Counters are updated through security-definer RPCs so concurrent events can't race.
-- =====================================================================================


-- =============================================
-- 1. emails — tracking + smart-sequence columns
-- =============================================
alter table emails add column if not exists open_count integer not null default 0;
alter table emails add column if not exists click_count integer not null default 0;
alter table emails add column if not exists first_opened_at timestamp with time zone;
alter table emails add column if not exists last_opened_at timestamp with time zone;
alter table emails add column if not exists first_clicked_at timestamp with time zone;
alter table emails add column if not exists last_clicked_at timestamp with time zone;

-- Smart sequences
--   trigger_condition : JSONB rule that produced/adjusted this email (audit trail for the UI)
--   triggered_by      : last smart action applied to this row: resent | accelerated | paused | cancelled
--   is_resend         : true for the "no opens after 48h" re-send copy (sequence_step = 0)
--   resend_of         : the original initial email this row is a re-send of
--   resent_at         : stamped on the ORIGINAL when a re-send copy was created (once-only guard)
--   accelerated_at    : stamped on a follow-up whose scheduled_at was pulled forward (bypasses the
--                       48h gap gate in the queue; once-only guard)
alter table emails add column if not exists trigger_condition jsonb;
alter table emails add column if not exists triggered_by text;
alter table emails add column if not exists is_resend boolean not null default false;
alter table emails add column if not exists resend_of uuid references emails(id) on delete set null;
alter table emails add column if not exists resent_at timestamp with time zone;
alter table emails add column if not exists accelerated_at timestamp with time zone;

create index if not exists idx_emails_message_id on emails(message_id) where message_id is not null;
create index if not exists idx_emails_lead_campaign on emails(lead_id, campaign_id);


-- =============================================
-- 2. campaigns — smart sequence toggle + config
-- =============================================
alter table campaigns add column if not exists smart_sequences_enabled boolean not null default false;
alter table campaigns add column if not exists smart_sequence_config jsonb not null default '{
  "accelerate_on_opens": true,
  "accelerate_opens_threshold": 2,
  "accelerate_opens_hours": 4,
  "accelerate_on_audit_click": true,
  "accelerate_click_hours": 2,
  "hot_lead_flag": true,
  "hot_lead_opens_threshold": 3
}'::jsonb;


-- =============================================
-- 3. user_plans — abuse-guard auto pause
-- =============================================
-- Set by the backend when a user's bounces + unsubscribes exceed the safety threshold for a
-- day. Their running campaigns are moved to 'draft' and the dashboard shows a warning.
-- Cleared when the user acknowledges the warning.
alter table user_plans add column if not exists auto_paused_at timestamp with time zone;
alter table user_plans add column if not exists auto_pause_reason text;


-- =============================================
-- 4. email_events — open / click tracking events
-- =============================================
create table if not exists email_events (
  id uuid primary key default uuid_generate_v4(),
  email_id uuid references emails(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  event_type text not null check (event_type in ('open', 'click')),
  url text,                       -- clicks only: the ORIGINAL destination URL
  ip_hash text default '',        -- sha256(ip + email_id), truncated — never the raw IP
  device text default 'desktop',  -- desktop | mobile
  created_at timestamp with time zone default now()
);

create index if not exists idx_email_events_email_id on email_events(email_id);
create index if not exists idx_email_events_user_created on email_events(user_id, created_at desc);
create index if not exists idx_email_events_created_at on email_events(created_at desc);

alter table email_events enable row level security;

drop policy if exists "Users can view their own email events" on email_events;
create policy "Users can view their own email events"
  on email_events for select using (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE for owners: the public tracking endpoints write via service role.
-- A world-open insert policy here would let anyone forge "opened" events into a tenant's UI.


-- =============================================
-- 5. imap_credentials — inbox read access (app passwords)
-- =============================================
create table if not exists imap_credentials (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  username text not null,
  password_encrypted text not null,   -- AES-256-GCM via utils/encryption.ts (same as SMTP passwords)
  use_tls boolean not null default true,
  is_active boolean not null default true,
  last_fetched_at timestamp with time zone,
  last_uid integer,                   -- highest IMAP UID processed in INBOX (incremental fetch)
  last_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, email)
);

create index if not exists idx_imap_credentials_user_id on imap_credentials(user_id);
create index if not exists idx_imap_credentials_active on imap_credentials(is_active) where is_active = true;

alter table imap_credentials enable row level security;

drop policy if exists "Users can view their own imap credentials" on imap_credentials;
create policy "Users can view their own imap credentials"
  on imap_credentials for select using (auth.uid() = user_id);
-- SELECT-only for the owner (rows hold encrypted passwords). Backend manages all writes.


-- =============================================
-- 6. replies — fetched inbound replies (+ our outbound replies for the thread view)
-- =============================================
create table if not exists replies (
  id uuid primary key default uuid_generate_v4(),
  email_id uuid references emails(id) on delete cascade not null,
  lead_id uuid references leads(id) on delete cascade not null,
  campaign_id uuid references campaigns(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_email text not null default '',
  to_email text not null default '',
  subject text not null default '',
  body_text text not null default '',
  body_html text,
  message_id text,                    -- this message's own Message-ID header
  in_reply_to text,                   -- Message-ID this message replies to
  received_at timestamp with time zone not null default now(),
  is_read boolean not null default false,
  is_archived boolean not null default false,
  classification text check (classification in ('interested', 'not_interested', 'out_of_office', 'unsubscribe', 'question', 'bounce')),
  classification_confidence numeric(4,3),  -- 0.000 – 1.000
  classification_reason text,
  classified_by text check (classified_by in ('ai', 'heuristic', 'user')),
  ooo_return_date date,               -- out_of_office only: detected return date
  imap_credential_id uuid references imap_credentials(id) on delete set null,
  created_at timestamp with time zone default now()
);

create index if not exists idx_replies_user_received on replies(user_id, received_at desc);
create index if not exists idx_replies_email_id on replies(email_id);
create index if not exists idx_replies_lead_id on replies(lead_id);
create index if not exists idx_replies_campaign_id on replies(campaign_id);
create index if not exists idx_replies_classification on replies(user_id, classification);
create index if not exists idx_replies_unread on replies(user_id) where is_read = false and is_archived = false and direction = 'inbound';
-- Never store the same inbound message twice for a user (IMAP re-fetch safety).
-- Must be a FULL unique index: the ingest upsert uses ON CONFLICT (user_id, message_id), and
-- Postgres cannot match a partial index to that clause. message_id is always set by the
-- ingester (a synthetic id is generated when the message has none).
drop index if exists idx_replies_user_message_id;
create unique index if not exists idx_replies_user_message_id on replies(user_id, message_id);

alter table replies enable row level security;

drop policy if exists "Users can view their own replies" on replies;
create policy "Users can view their own replies"
  on replies for select using (auth.uid() = user_id);
-- Writes (read/archive/classify) go through the authenticated backend API (service role).


-- =============================================
-- 7. email_suppressions — already exists (schema.sql). Extend reason values only.
-- =============================================
-- reason: unsubscribe | unsubscribe_reply | bounce | complaint | manual
-- (free text column, no constraint to change). Nothing to do here.


-- =============================================
-- 8. job_locks — lock row for the reply fetcher
-- =============================================
insert into job_locks (lock_name, locked_at, locked_by)
values ('reply_fetch', '2000-01-01T00:00:00Z', '')
on conflict (lock_name) do nothing;


-- =============================================
-- 9. RPCs — atomic tracking counters
-- =============================================
-- Called by the public tracking endpoints (service role). Increment + first/last stamps in
-- one statement so concurrent pixel loads can't lose an increment.
create or replace function record_email_open(p_email_id uuid)
returns void as $$
  update emails
  set open_count = coalesce(open_count, 0) + 1,
      first_opened_at = coalesce(first_opened_at, now()),
      last_opened_at = now()
  where id = p_email_id;
$$ language sql volatile security definer;

create or replace function record_email_click(p_email_id uuid)
returns void as $$
  update emails
  set click_count = coalesce(click_count, 0) + 1,
      first_clicked_at = coalesce(first_clicked_at, now()),
      last_clicked_at = now()
  where id = p_email_id;
$$ language sql volatile security definer;


-- =============================================
-- Verify (expected results in comments)
-- =============================================
--   select column_name from information_schema.columns where table_name = 'emails'
--     and column_name in ('open_count','click_count','trigger_condition','is_resend','accelerated_at');
--     -> 5 rows
--   select tablename, policyname, cmd from pg_policies
--     where tablename in ('email_events','imap_credentials','replies') order by tablename;
--     -> exactly one SELECT policy per table
--   select lock_name from job_locks;  -> email_queue, csv_drip_feed, reply_fetch
