-- ============================================================
-- 078_automation_send_slot_release.sql
--
-- The hourly slot is only consumed when WhatsApp accepts the send.
-- claim_automation_send_slot now returns the event id so the engine
-- can delete that row if the provider call fails.
-- Return type changes, so the 077 function has to be dropped first.
-- ============================================================

DROP FUNCTION IF EXISTS public.claim_automation_send_slot(uuid);

CREATE OR REPLACE FUNCTION public.claim_automation_send_slot(p_account_id uuid)
RETURNS TABLE (claimed boolean, retry_at timestamptz, event_id uuid)
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
  v_event_id uuid;
BEGIN
  SELECT automation_hourly_send_limit
    INTO v_limit
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    claimed := false;
    retry_at := now() + interval '1 minute';
    event_id := NULL;
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
    event_id := NULL;
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
    event_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_gap_ms := 15000 + floor(random() * 30001)::int;

  INSERT INTO automation_send_events (account_id, sent_at, next_gap_ms)
  VALUES (p_account_id, now(), v_gap_ms)
  RETURNING id INTO v_event_id;

  claimed := true;
  retry_at := NULL;
  event_id := v_event_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_send_slot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_automation_send_slot(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_send_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_automation_send_slot(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM automation_send_events WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_automation_send_slot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_automation_send_slot(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_automation_send_slot(uuid) TO service_role;
