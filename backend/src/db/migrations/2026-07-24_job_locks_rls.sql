-- =============================================
-- MIGRATION (2026-07-24): enable RLS on job_locks
-- Safe to run on an existing database (idempotent).
--
-- job_locks was the one public-schema table without Row Level Security, so the
-- anon key (shipped to the browser) could read/write it via PostgREST — e.g. grab
-- the email_queue lock and never release it, halting all sending (a DoS vector).
--
-- Background workers touch this table ONLY through the service role and the
-- security-definer RPCs acquire_job_lock / release_job_lock / heartbeat_job_lock,
-- all of which bypass RLS. The frontend never touches it. So enabling RLS with NO
-- policies denies the anon/authenticated roles entirely while the workers keep
-- functioning unchanged.
-- =============================================

alter table job_locks enable row level security;
