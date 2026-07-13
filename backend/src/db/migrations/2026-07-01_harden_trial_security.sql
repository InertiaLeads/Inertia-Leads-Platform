-- =====================================================================================
-- Migration: Harden free-trial security  (run on BOTH dev and production Supabase)
-- Date: 2026-07-01
--
-- Covers:
--   #1 CRITICAL — remove owner INSERT/UPDATE/DELETE on billing/credential tables so a user
--                 cannot self-grant/extend a trial (or reset it) from the browser anon key.
--   #4 MEDIUM   — atomic check-and-reserve RPCs so concurrent requests can't overshoot the
--                 daily generation / lead-find caps.
--
-- Safe to run more than once (idempotent: drop-if-exists + create-or-replace).
-- The app never writes these tables from the frontend — all writes go through the
-- service-role backend, which bypasses RLS — so removing owner writes breaks nothing.
-- =====================================================================================

-- ---------- #1  Lock down user_plans (billing/trial state) : SELECT-only for owner ----------
drop policy if exists "Users can insert their own plan" on user_plans;
drop policy if exists "Users can update their own plan" on user_plans;
drop policy if exists "Users can delete their own plan" on user_plans;
-- keep: "Users can view their own plan" (SELECT)

-- ---------- #1  Lock down credential tables (OAuth tokens / SMTP passwords) ----------
drop policy if exists "Users can insert their own gmail accounts" on gmail_accounts;
drop policy if exists "Users can update their own gmail accounts" on gmail_accounts;
drop policy if exists "Users can delete their own gmail accounts" on gmail_accounts;

drop policy if exists "Users can insert their own smtp accounts" on smtp_accounts;
drop policy if exists "Users can update their own smtp accounts" on smtp_accounts;
drop policy if exists "Users can delete their own smtp accounts" on smtp_accounts;

-- Verify afterwards with:
--   select tablename, policyname, cmd from pg_policies
--   where tablename in ('user_plans','gmail_accounts','smtp_accounts') order by tablename, cmd;
-- Expect only SELECT policies to remain.


-- ---------- #4  Atomic check-and-reserve for daily generation cap ----------
-- Atomically resets the counter on a new day (user timezone), then grants
-- least(p_requested, p_limit - current) and increments by the granted amount.
-- Returns the number actually granted (0 if the cap is already reached).
-- Callers must generate ONLY the granted amount — no separate increment afterwards.
create or replace function reserve_emails_generated_today(
  p_user_id uuid,
  p_requested integer,
  p_limit integer
) returns integer as $$
declare
  v_user_tz text;
  v_midnight timestamp with time zone;
  v_current integer;
  v_granted integer;
begin
  select coalesce(timezone, 'UTC') into v_user_tz from user_plans where user_id = p_user_id;
  v_midnight := date_trunc('day', now() at time zone v_user_tz) at time zone v_user_tz;

  -- Lock the row so concurrent reservations serialize.
  select case
           when emails_generated_today_reset_at is null or emails_generated_today_reset_at < v_midnight
           then 0 else coalesce(emails_generated_today, 0)
         end
    into v_current
  from user_plans where user_id = p_user_id for update;

  v_granted := greatest(0, least(p_requested, p_limit - v_current));

  update user_plans
  set emails_generated_today = v_current + v_granted,
      emails_generated_today_reset_at = case
        when emails_generated_today_reset_at is null or emails_generated_today_reset_at < v_midnight
        then v_midnight else emails_generated_today_reset_at end,
      updated_at = now()
  where user_id = p_user_id;

  return v_granted;
end;
$$ language plpgsql security definer;

-- ---------- #4  Release (reconcile) unused generation reservation ----------
-- Called ONLY within the same request that reserved, to give back quota for leads that
-- turned out invalid / suppressed / failed generation. p_count is bounded by what was granted,
-- so this cannot be abused to claw back quota across requests. Never drops below 0.
create or replace function release_emails_generated_today(p_user_id uuid, p_count integer)
returns void as $$
begin
  if p_count is null or p_count <= 0 then return; end if;
  update user_plans
  set emails_generated_today = greatest(0, coalesce(emails_generated_today, 0) - p_count),
      updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;
