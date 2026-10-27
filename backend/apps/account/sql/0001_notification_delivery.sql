-- Email delivery state for in-app notifications. The digest job (apps.account.tasks) sends each notification
-- at most once and records why it did not when it skips one.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_status text
  CHECK (email_status IS NULL OR email_status IN ('sent', 'skipped', 'failed'));
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
-- Notifications that existed before email delivery are not sent retroactively.
UPDATE public.notifications SET email_status = 'skipped' WHERE email_status IS NULL;
CREATE INDEX IF NOT EXISTS notifications_email_pending_idx ON public.notifications(created_at)
  WHERE email_status IS NULL;
-- The digest job runs as service_role and needs only these columns of the sign-in accounts.
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT (id, email, email_confirmed_at) ON auth.users TO service_role;
