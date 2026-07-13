-- =============================================
-- AI Lead Gen SaaS — Database Schema
-- Run this in your Supabase SQL Editor
-- =============================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- =============================================
-- Table: lead_sources
-- =============================================
create table if not exists lead_sources (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  niche text not null,
  location text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed')),
  created_at timestamp with time zone default now()
);

-- =============================================
-- Table: leads
-- =============================================
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  campaign_id uuid,
  source_id uuid references lead_sources(id) on delete set null,
  name text not null default '',
  email text not null default '',
  company text not null default '',
  website text default '',
  phone text default '',
  industry text default '',
  contact_method text not null default 'email' check (contact_method in ('email', 'call')),
  source_type text not null default 'auto_find' check (source_type in ('auto_find', 'csv', 'csv_queued')),
  enriched_data jsonb,
  detected_language text default 'eng',
  score integer default 0,
  contacted boolean default false,
  contacted_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- Prevent duplicate leads per user (same website = same business)
create unique index if not exists idx_leads_user_website
  on leads (user_id, website)
  where website is not null and website != '';

-- Prevent duplicate leads per user (same company+phone = same business)
create unique index if not exists idx_leads_user_company_phone
  on leads (user_id, company, phone)
  where company is not null and company != ''
    and phone is not null and phone != '';

-- =============================================
-- Function: get_campaign_lead_counts
-- Returns aggregated lead counts per campaign in a single query
-- =============================================
create or replace function get_campaign_lead_counts(p_user_id uuid, p_campaign_ids uuid[])
returns table(campaign_id uuid, total bigint, queued bigint, has_auto_find boolean, has_csv boolean)
language sql stable
as $$
  select
    l.campaign_id,
    count(*) as total,
    count(*) filter (where l.source_type = 'csv_queued') as queued,
    bool_or(l.source_type = 'auto_find') as has_auto_find,
    bool_or(l.source_type in ('csv', 'csv_queued')) as has_csv
  from leads l
  where l.user_id = p_user_id
    and l.campaign_id = any(p_campaign_ids)
  group by l.campaign_id;
$$;

-- =============================================
-- Table: campaigns
-- =============================================

-- Campaign status: draft, running, completed, failed
create table if not exists campaigns (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'completed', 'failed')),
  total_leads integer default 0,
  queued_leads integer default 0,
  enable_followups boolean default true,
  send_timezone text not null default 'US_EAST' check (send_timezone in ('US_EAST', 'US_CENTRAL', 'US_MOUNTAIN', 'US_WEST', 'US_ALASKA', 'US_HAWAII', 'CA_ATLANTIC', 'CA_NEWFOUNDLAND', 'UK', 'EU_CENTRAL', 'EU_EAST', 'UAE', 'ARABIA', 'INDIA', 'SINGAPORE', 'PHILIPPINES', 'JAPAN', 'AU_WEST', 'AU_CENTRAL', 'AU_EAST', 'NZ', 'BRAZIL', 'SOUTH_AFRICA')),
  settings_confirmed boolean default false,
  created_at timestamp with time zone default now()
);

-- Add foreign key from leads to campaigns
alter table leads
  add constraint fk_leads_campaign
  foreign key (campaign_id) references campaigns(id) on delete cascade;

-- =============================================
-- Table: gmail_accounts (multi-inbox rotation)
-- =============================================
-- Each user can connect multiple Gmail accounts (1-4 depending on plan).
-- The first connected account is marked is_primary = true.
-- Emails are distributed round-robin across accounts.
create table if not exists gmail_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamp with time zone not null,
  is_primary boolean default false,
  warmup_started_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, email)
);

-- =============================================
-- Table: emails
-- =============================================

-- Email status: pending, sending, sent, failed, cancelled
--   'sending' is a transient claim state: a worker atomically flips pending -> sending
--   before contacting the provider so no two workers can ever send the same email.
-- sequence_step: 1 = initial, 2 = follow-up 1, 3 = follow-up 2
create table if not exists emails (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  campaign_id uuid references campaigns(id) on delete cascade not null,
  lead_id uuid references leads(id) on delete cascade not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  sequence_step integer default 1,
  tone_variant text default 'friendly',
  replied boolean default false,
  replied_at timestamp with time zone,
  retry_count integer default 0,
  error_log text,
  sent_at timestamp with time zone,
  scheduled_at timestamp with time zone,
  claimed_at timestamp with time zone, -- when a worker claimed this email for sending (status='sending')
  gmail_account_id uuid references gmail_accounts(id) on delete set null,
  created_at timestamp with time zone default now()
);

-- =============================================
-- Table: user_plans (subscription tier + warmup tracking)
-- =============================================
create table if not exists user_plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  plan text not null default 'starter' check (plan in ('starter', 'growth', 'agency')),
  service_type text not null default 'web_dev' check (service_type in ('web_dev', 'seo', 'digital_marketing', 'social_media')),
  subscription_status text not null default 'none' check (subscription_status in ('none', 'trialing', 'active', 'cancelled', 'past_due', 'paused', 'expired')),
  trial_ends_at timestamp with time zone default null,
  lemon_squeezy_subscription_id text,
  lemon_squeezy_customer_id text,
  current_period_end timestamp with time zone,
  current_period_start timestamp with time zone,
  gmail_connected_at timestamp with time zone,
  is_active boolean default true,
  leads_found_this_month integer default 0,
  leads_found_reset_at timestamp with time zone default now(),
  leads_found_today integer default 0,
  leads_found_today_reset_at timestamp with time zone default now(),
  emails_generated_today integer default 0,
  emails_generated_today_reset_at timestamp with time zone default now(),
  emails_sent_today integer default 0,
  emails_sent_today_reset_at timestamp with time zone default now(),
  timezone text not null default 'UTC',
  timezone_updated_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- =============================================
-- RPC: Atomically increment daily leads counter
-- Resets at the user's local midnight. The reset_at is compared
-- against today's midnight in the user's timezone.
-- Anti-exploit: timezone changes are locked to once per 24h in app code.
-- =============================================
create or replace function increment_leads_found_today(p_user_id uuid, p_count integer)
returns void as $$
declare
  v_user_tz text;
  v_midnight timestamp with time zone;
begin
  select coalesce(timezone, 'UTC') into v_user_tz from user_plans where user_id = p_user_id;
  v_midnight := date_trunc('day', now() at time zone v_user_tz) at time zone v_user_tz;

  update user_plans
  set
    leads_found_today = case
      when leads_found_today_reset_at is null or leads_found_today_reset_at < v_midnight
      then p_count
      else leads_found_today + p_count
    end,
    leads_found_today_reset_at = case
      when leads_found_today_reset_at is null or leads_found_today_reset_at < v_midnight
      then v_midnight
      else leads_found_today_reset_at
    end,
    updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- =============================================
-- RPC: Atomically increment daily email generation counter
-- Same midnight-based reset pattern.
-- =============================================
create or replace function increment_emails_generated_today(p_user_id uuid, p_count integer)
returns void as $$
declare
  v_user_tz text;
  v_midnight timestamp with time zone;
begin
  select coalesce(timezone, 'UTC') into v_user_tz from user_plans where user_id = p_user_id;
  v_midnight := date_trunc('day', now() at time zone v_user_tz) at time zone v_user_tz;

  update user_plans
  set
    emails_generated_today = case
      when emails_generated_today_reset_at is null or emails_generated_today_reset_at < v_midnight
      then p_count
      else emails_generated_today + p_count
    end,
    emails_generated_today_reset_at = case
      when emails_generated_today_reset_at is null or emails_generated_today_reset_at < v_midnight
      then v_midnight
      else emails_generated_today_reset_at
    end,
    updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- =============================================
-- RPC: Atomically increment daily email sent counter
-- Same midnight-based reset pattern.
-- =============================================
create or replace function increment_emails_sent_today(p_user_id uuid, p_count integer)
returns void as $$
declare
  v_user_tz text;
  v_midnight timestamp with time zone;
begin
  select coalesce(timezone, 'UTC') into v_user_tz from user_plans where user_id = p_user_id;
  v_midnight := date_trunc('day', now() at time zone v_user_tz) at time zone v_user_tz;

  update user_plans
  set
    emails_sent_today = case
      when emails_sent_today_reset_at is null or emails_sent_today_reset_at < v_midnight
      then p_count
      else emails_sent_today + p_count
    end,
    emails_sent_today_reset_at = case
      when emails_sent_today_reset_at is null or emails_sent_today_reset_at < v_midnight
      then v_midnight
      else emails_sent_today_reset_at
    end,
    updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- =============================================
-- Row Level Security
-- =============================================

-- Lead Sources RLS
alter table lead_sources enable row level security;

create policy "Users can view their own lead sources"
  on lead_sources for select using (auth.uid() = user_id);

create policy "Users can insert their own lead sources"
  on lead_sources for insert with check (auth.uid() = user_id);

create policy "Users can update their own lead sources"
  on lead_sources for update using (auth.uid() = user_id);

create policy "Users can delete their own lead sources"
  on lead_sources for delete using (auth.uid() = user_id);

-- Leads RLS
alter table leads enable row level security;

create policy "Users can view their own leads"
  on leads for select using (auth.uid() = user_id);

create policy "Users can insert their own leads"
  on leads for insert with check (auth.uid() = user_id);

create policy "Users can update their own leads"
  on leads for update using (auth.uid() = user_id);

create policy "Users can delete their own leads"
  on leads for delete using (auth.uid() = user_id);

-- Campaigns RLS
alter table campaigns enable row level security;

create policy "Users can view their own campaigns"
  on campaigns for select using (auth.uid() = user_id);

create policy "Users can insert their own campaigns"
  on campaigns for insert with check (auth.uid() = user_id);

create policy "Users can update their own campaigns"
  on campaigns for update using (auth.uid() = user_id);

create policy "Users can delete their own campaigns"
  on campaigns for delete using (auth.uid() = user_id);

-- Emails RLS
alter table emails enable row level security;

create policy "Users can view their own emails"
  on emails for select using (auth.uid() = user_id);

create policy "Users can insert their own emails"
  on emails for insert with check (auth.uid() = user_id);

create policy "Users can update their own emails"
  on emails for update using (auth.uid() = user_id);

create policy "Users can delete their own emails"
  on emails for delete using (auth.uid() = user_id);

-- Gmail Accounts RLS
-- SELECT-only for the owner. These rows hold OAuth access/refresh tokens; the backend
-- (service role) manages all writes. Owner writes are not granted so a user can't inject or
-- tamper with credential rows via the anon key.
alter table gmail_accounts enable row level security;

create policy "Users can view their own gmail accounts"
  on gmail_accounts for select using (auth.uid() = user_id);

-- User Plans RLS
-- SELECT-ONLY for the row owner. This table holds authoritative billing/trial state
-- (subscription_status, trial_ends_at, current_period_end, plan). ALL writes go through the
-- service-role backend (trial provisioning + Lemon Squeezy webhook), which bypasses RLS.
-- Owner INSERT/UPDATE/DELETE are intentionally NOT granted — otherwise a user could set
-- their own subscription_status='active' or trial_ends_at far in the future from the browser
-- (anon key) and get free access forever, or delete the row to reset their trial.
alter table user_plans enable row level security;

create policy "Users can view their own plan"
  on user_plans for select using (auth.uid() = user_id);

-- =============================================
-- Indexes for query performance
-- =============================================
create index if not exists idx_lead_sources_user_id on lead_sources(user_id);
create index if not exists idx_lead_sources_status on lead_sources(status);
create index if not exists idx_leads_user_id on leads(user_id);
create index if not exists idx_leads_campaign_id on leads(campaign_id);
create index if not exists idx_leads_source_id on leads(source_id);
create index if not exists idx_leads_score on leads(score);
create index if not exists idx_campaigns_user_id on campaigns(user_id);
create index if not exists idx_campaigns_status on campaigns(status);
create index if not exists idx_emails_campaign_id on emails(campaign_id);
create index if not exists idx_emails_user_id on emails(user_id);
create index if not exists idx_emails_status on emails(status);
create index if not exists idx_emails_scheduled_at on emails(scheduled_at);
create index if not exists idx_gmail_accounts_user_id on gmail_accounts(user_id);
create index if not exists idx_emails_gmail_account_id on emails(gmail_account_id);
create index if not exists idx_user_plans_user_id on user_plans(user_id);

-- =============================================
-- Function: Atomic increment for leads_found_this_month
-- Prevents race conditions when multiple requests update simultaneously
-- =============================================
create or replace function increment_leads_found(p_user_id uuid, p_count integer)
returns void as $$
  update user_plans
  set leads_found_this_month = leads_found_this_month + p_count,
      updated_at = now()
  where user_id = p_user_id;
$$ language sql volatile;

-- =============================================
-- Table: smtp_accounts (SMTP email sending)
-- =============================================
-- Users can connect SMTP accounts (Outlook, Zoho, custom domain, etc.)
-- alongside Gmail accounts for inbox rotation.
create table if not exists smtp_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  display_name text default '',
  host text not null,
  port integer not null default 587,
  username text not null,
  password_encrypted text not null,
  use_tls boolean default true,
  is_primary boolean default false,
  warmup_started_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, email)
);

-- SMTP Accounts RLS
-- SELECT-only for the owner. These rows hold encrypted SMTP passwords; the backend
-- (service role) manages all writes. Owner writes are not granted.
alter table smtp_accounts enable row level security;

create policy "Users can view their own smtp accounts"
  on smtp_accounts for select using (auth.uid() = user_id);

create index if not exists idx_smtp_accounts_user_id on smtp_accounts(user_id);

-- Add smtp_account_id to emails table (nullable, alongside gmail_account_id)
alter table emails add column if not exists smtp_account_id uuid references smtp_accounts(id) on delete set null;
create index if not exists idx_emails_smtp_account_id on emails(smtp_account_id);

-- =============================================
-- Table: job_locks (distributed locking for background jobs)
-- =============================================
-- Prevents duplicate processing when multiple server instances run.
-- Each background job (email queue, CSV drip-feed) claims a named lock
-- before processing. If the lock is already held, the instance skips.
-- Stale locks auto-expire after 5 minutes (process crash safety).
create table if not exists job_locks (
  lock_name text primary key,
  locked_at timestamp with time zone not null default now(),
  locked_by text not null default ''
);

-- Pre-insert lock rows so we only need UPDATE (no INSERT race conditions)
insert into job_locks (lock_name, locked_at, locked_by)
values
  ('email_queue', '2000-01-01T00:00:00Z', ''),
  ('csv_drip_feed', '2000-01-01T00:00:00Z', '')
on conflict (lock_name) do nothing;

-- =============================================
-- Table: audit_views (track when leads view their audit report)
-- =============================================
-- Records each time a lead opens their personalized audit report link.
-- Used to notify the sender that a lead is engaged (hot lead signal).
create table if not exists audit_views (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  ip_hash text default '',
  device text default 'desktop',
  viewed_at timestamp with time zone default now()
);

-- Indexes for fast lookups
create index if not exists idx_audit_views_lead_id on audit_views(lead_id);
create index if not exists idx_audit_views_user_id on audit_views(user_id);
create index if not exists idx_audit_views_viewed_at on audit_views(viewed_at);

-- RLS: Users can only see views for their own leads
alter table audit_views enable row level security;

create policy "Users can view their own audit views"
  on audit_views for select using (auth.uid() = user_id);

create policy "Service can insert audit views"
  on audit_views for insert with check (true);

create policy "Users can delete their own audit views"
  on audit_views for delete using (auth.uid() = user_id);

-- RPC: Attempt to acquire a named lock.
-- Returns true if acquired, false if another instance holds it.
-- Lock expires after 5 minutes (stale lock protection).
create or replace function acquire_job_lock(p_lock_name text, p_locked_by text)
returns boolean as $$
declare
  rows_updated integer;
begin
  update job_locks
  set locked_at = now(), locked_by = p_locked_by
  where lock_name = p_lock_name
    and (locked_by = '' or locked_at < now() - interval '5 minutes');
  get diagnostics rows_updated = row_count;
  return rows_updated > 0;
end;
$$ language plpgsql volatile security definer;

-- RPC: Release a named lock (only if we hold it).
create or replace function release_job_lock(p_lock_name text, p_locked_by text)
returns void as $$
  update job_locks
  set locked_at = '2000-01-01T00:00:00Z', locked_by = ''
  where lock_name = p_lock_name and locked_by = p_locked_by;
$$ language sql volatile security definer;

-- =============================================
-- Table: audit_logs (security audit trail)
-- =============================================
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource text,
  resource_id text,
  ip_address text,
  user_agent text,
  metadata jsonb default '{}',
  created_at timestamp with time zone default now()
);

-- Index for querying by user and time
create index if not exists idx_audit_logs_user_id on audit_logs(user_id);
create index if not exists idx_audit_logs_action on audit_logs(action);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);

-- RLS: Users can only see their own audit logs
alter table audit_logs enable row level security;

create policy "Users can view their own audit logs"
  on audit_logs for select using (auth.uid() = user_id);

create policy "Service can insert audit logs"
  on audit_logs for insert with check (true);

-- Auto-cleanup: delete audit logs older than 90 days (run via pg_cron or scheduled function)
-- select delete from audit_logs where created_at < now() - interval '90 days';

-- =============================================
-- MIGRATION (2026-06): exactly-once email sending
-- Safe to run on an existing database (idempotent). Closes the double-send race
-- in the email queue. See backend/src/jobs/emailQueue.ts for the matching logic.
-- =============================================

-- 1. Allow the transient "sending" claim state on the emails status constraint.
alter table emails drop constraint if exists emails_status_check;
alter table emails add constraint emails_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled'));

-- 2. Track when an email was claimed for sending (used by the stuck-send reaper).
alter table emails add column if not exists claimed_at timestamp with time zone;
create index if not exists idx_emails_claimed_at on emails(claimed_at);

-- 3. Heartbeat RPC: a live worker re-stamps its lock so it never looks "stale"
--    while it is still working. Without this, a run longer than the 5-minute
--    stale-lock TTL would have its lock expire mid-run, letting a second cycle
--    start. With the heartbeat, the lock only expires if the worker truly dies.
create or replace function heartbeat_job_lock(p_lock_name text, p_locked_by text)
returns void as $$
  update job_locks
  set locked_at = now()
  where lock_name = p_lock_name and locked_by = p_locked_by;
$$ language sql volatile security definer;

-- =============================================
-- Table: email_suppressions (per-user unsubscribe / opt-out list)
-- =============================================
-- When a recipient unsubscribes (one-click List-Unsubscribe, footer link, or
-- manual add), their address is recorded here for that user. No email — initial
-- or follow-up — is ever sent to a suppressed address again. Per-user scoped:
-- one customer's opt-out does not affect another customer's sending.
create table if not exists email_suppressions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  reason text not null default 'unsubscribe', -- unsubscribe | bounce | complaint | manual
  lead_id uuid references leads(id) on delete set null,
  created_at timestamp with time zone default now(),
  unique(user_id, email)
);

create index if not exists idx_email_suppressions_user_email on email_suppressions(user_id, email);

-- RLS: users can see and manage only their own suppressions.
-- (The public unsubscribe endpoint writes via the service role, which bypasses RLS.)
alter table email_suppressions enable row level security;

create policy "Users can view their own suppressions"
  on email_suppressions for select using (auth.uid() = user_id);

create policy "Users can insert their own suppressions"
  on email_suppressions for insert with check (auth.uid() = user_id);

create policy "Users can delete their own suppressions"
  on email_suppressions for delete using (auth.uid() = user_id);
