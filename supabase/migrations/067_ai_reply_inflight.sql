-- ============================================================
-- 067_ai_reply_inflight.sql
--
-- Cloud API + WAHA + Meta retries all dispatch auto-reply on the
-- same inbound. claim_ai_reply_slot only caps the TOTAL replies
-- (default 3), so three concurrent generators each take a slot and
-- the customer gets three near-identical pitches, then a handoff.
--
-- begin_ai_reply takes an exclusive in-flight lock (stale after 60s
-- if the process dies). finish_ai_reply always clears it.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_reply_inflight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_reply_inflight_at timestamptz;

COMMENT ON COLUMN conversations.ai_reply_inflight IS
  'True while auto-reply is generating a response. Prevents duplicate bot texts from concurrent webhooks.';
COMMENT ON COLUMN conversations.ai_reply_inflight_at IS
  'When the in-flight lock was taken. Locks older than 60s are treated as stale.';

CREATE OR REPLACE FUNCTION public.begin_ai_reply(
  p_conversation_id uuid,
  p_max_replies integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disabled boolean;
  v_inflight boolean;
  v_at timestamptz;
  v_count integer;
BEGIN
  SELECT ai_autoreply_disabled, ai_reply_inflight, ai_reply_inflight_at, ai_reply_count
    INTO v_disabled, v_inflight, v_at, v_count
  FROM conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_disabled THEN
    RETURN 'paused';
  END IF;
  IF v_count >= GREATEST(p_max_replies, 0) THEN
    RETURN 'capped';
  END IF;
  IF v_inflight
     AND v_at IS NOT NULL
     AND v_at > now() - interval '60 seconds' THEN
    RETURN 'busy';
  END IF;

  UPDATE conversations
  SET
    ai_reply_inflight = true,
    ai_reply_inflight_at = now()
  WHERE id = p_conversation_id;

  RETURN 'claimed';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_ai_reply(p_conversation_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET ai_reply_inflight = false
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.begin_ai_reply(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_ai_reply(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_ai_reply(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.finish_ai_reply(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_ai_reply(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_ai_reply(uuid) TO service_role;
