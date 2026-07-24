-- =============================================
-- MIGRATION (2026-07-24): email threading
-- Safe to run on an existing database (idempotent).
--
-- Stores the identifiers needed to thread follow-ups under the initial email so
-- Gmail (and other clients) group the whole sequence into one conversation
-- instead of showing each follow-up as a brand-new email:
--   message_id : the RFC 2822 Message-ID header value of THIS email. Follow-ups
--                reference it via In-Reply-To / References headers.
--   thread_id  : the Gmail API thread id of THIS email. Passed as the follow-up's
--                threadId so the Gmail API files it into the same conversation.
--                (NULL for SMTP sends — SMTP threads purely on the header chain.)
-- Both are populated by backend/src/jobs/emailQueue.ts when an email is sent.
-- =============================================

alter table emails add column if not exists message_id text;
alter table emails add column if not exists thread_id text;
