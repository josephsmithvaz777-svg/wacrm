-- ============================================================
-- 077_automation_warming.sql
--
-- WhatsApp warming sequences:
--   * automations.stop_on_reply — opt-in. Existing rows stay false,
--     so a saved "Calentamiento 30 días" keeps running as before
--     until someone turns the switch on.
--   * accounts.automation_hourly_send_limit — cron send cap (default 40).
--   * automation_send_events — rolling hour counter + random gap.
--   * pending status "cancelled" — a reply drops queued waits.
--
-- The send-file step stores only an external URL inside
-- automation_steps.step_config. No storage bucket, no file bytes.
-- ============================================================

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS stop_on_reply boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_automations_stop_on_reply
  ON automations (account_id)
  WHERE stop_on_reply = true;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS automation_hourly_send_limit integer NOT NULL DEFAULT 40;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_automation_hourly_send_limit_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_automation_hourly_send_limit_check
  CHECK (automation_hourly_send_limit BETWEEN 1 AND 500);

-- Inline CHECK constraints are named {table}_{column}_check, but a
-- renamed one would make a bare DROP fail. Drop whichever check
-- mentions status, then install the set that includes 'cancelled'.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'automation_pending_executions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.automation_pending_executions DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_automation_pending_contact_status
  ON automation_pending_executions (account_id, contact_id, status);

CREATE TABLE IF NOT EXISTS automation_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Milliseconds the next automation send for this account must wait.
  next_gap_ms integer NOT NULL CHECK (next_gap_ms >= 0 AND next_gap_ms <= 600000)
);

CREATE INDEX IF NOT EXISTS automation_send_events_account_sent_idx
  ON automation_send_events (account_id, sent_at DESC);

ALTER TABLE automation_send_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_send_events_select ON automation_send_events;
CREATE POLICY automation_send_events_select ON automation_send_events
  FOR SELECT
  USING (is_account_member(account_id));

-- Inserts happen only from the service role (cron / engine). No
-- INSERT/UPDATE/DELETE policy for authenticated, so a member cannot
-- forge quota rows through the Data API.

-- Claims one outbound slot for the account, or tells the caller when
-- to try again. Locks the account row so overlapping cron hits cannot
-- both pass the hourly count. Not SECURITY DEFINER: only service_role
-- may execute it, and that role bypasses RLS.
CREATE OR REPLACE FUNCTION public.claim_automation_send_slot(p_account_id uuid)
RETURNS TABLE (claimed boolean, retry_at timestamptz)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
  v_oldest timestamptz;
  v_last timestamptz;
  v_last_gap integer;
  v_gap_ms integer;
BEGIN
  SELECT automation_hourly_send_limit
    INTO v_limit
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    claimed := false;
    retry_at := now() + interval '1 minute';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_limit IS NULL OR v_limit < 1 THEN
    v_limit := 40;
  ELSIF v_limit > 500 THEN
    v_limit := 500;
  END IF;

  DELETE FROM automation_send_events
  WHERE account_id = p_account_id
    AND sent_at < now() - interval '2 hours';

  SELECT count(*)::int, min(sent_at)
    INTO v_count, v_oldest
  FROM automation_send_events
  WHERE account_id = p_account_id
    AND sent_at > now() - interval '1 hour';

  IF v_count >= v_limit THEN
    claimed := false;
    retry_at := v_oldest + interval '1 hour'
      + (floor(random() * 50 + 10)::int || ' seconds')::interval;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT sent_at, next_gap_ms
    INTO v_last, v_last_gap
  FROM automation_send_events
  WHERE account_id = p_account_id
  ORDER BY sent_at DESC
  LIMIT 1;

  IF v_last IS NOT NULL
     AND v_last_gap IS NOT NULL
     AND v_last + (v_last_gap || ' milliseconds')::interval > now() THEN
    claimed := false;
    retry_at := v_last + (v_last_gap || ' milliseconds')::interval;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 15s–45s. A one-minute cron still finds the next row due; a single
  -- cron call cannot dump the whole queue in the same second.
  v_gap_ms := 15000 + floor(random() * 30001)::int;

  INSERT INTO automation_send_events (account_id, sent_at, next_gap_ms)
  VALUES (p_account_id, now(), v_gap_ms);

  claimed := true;
  retry_at := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_send_slot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_automation_send_slot(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_send_slot(uuid) TO service_role;
