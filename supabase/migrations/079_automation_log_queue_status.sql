-- ============================================================
-- 079_automation_log_queue_status.sql
--
-- A run that is waiting or in flight is not a failure. automation_logs
-- may be 'queued' (enrolamiento) or 'running' (el motor ya empezó).
-- The cron stamps claimed_at when it takes a row, and gives back any
-- 'running' row older than 5 minutes. Members can read the queue so
-- the logs page can say "En cola".
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'automation_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.automation_logs DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_status_check
  CHECK (status IN ('success', 'partial', 'failed', 'queued', 'running'));

ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_automation_pending_running_claimed
  ON public.automation_pending_executions (claimed_at)
  WHERE status = 'running';

DROP POLICY IF EXISTS automation_pending_executions_select
  ON public.automation_pending_executions;
CREATE POLICY automation_pending_executions_select
  ON public.automation_pending_executions
  FOR SELECT
  USING (is_account_member(account_id));
