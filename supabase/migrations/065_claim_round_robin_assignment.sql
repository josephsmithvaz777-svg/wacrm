-- ============================================================
-- 065_claim_round_robin_assignment.sql
--
-- Atomic round-robin claim. Inbound (Cloud API + WAHA) and AI
-- handoff used to call pick-then-assign separately. Concurrent
-- handlers all saw "unassigned", each advanced the cursor, and the
-- last write won — so Isaac would get the lead for ~1s and then
-- lose it to Brenda and Jimena in the same second.
--
-- Lock the conversation first. If it already sits on an advisor in
-- the pool, return that id and do not touch the cursor. Only lock
-- the account (cursor) when a real pick is needed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_round_robin_assignment(
  p_account_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_last uuid;
  v_current uuid;
  v_contact uuid;
  v_next uuid;
  v_pool uuid[];
  v_pos integer;
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM profiles
      WHERE user_id = auth.uid()
        AND account_id = p_account_id
    ) THEN
      RAISE EXCEPTION 'not authorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT user_id
      FROM profiles
      WHERE account_id = p_account_id
        AND account_role = 'agent'
      ORDER BY user_id
    ),
    ARRAY[]::uuid[]
  )
  INTO v_pool;

  IF cardinality(v_pool) = 0 THEN
    SELECT ARRAY(
      SELECT user_id
      FROM profiles
      WHERE account_id = p_account_id
        AND account_role = 'owner'
      ORDER BY user_id
    )
    INTO v_pool;
  END IF;

  SELECT assigned_agent_id, contact_id
    INTO v_current, v_contact
  FROM conversations
  WHERE id = p_conversation_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('agent_id', null, 'claimed', false);
  END IF;

  IF v_contact IS NULL THEN
    v_contact := p_contact_id;
  END IF;

  -- Advisor WhatsApp numbers are inboxes, not leads.
  IF EXISTS (
    SELECT 1
    FROM contacts c
    JOIN profiles p
      ON p.account_id = p_account_id
     AND coalesce(p.phone, '') <> ''
    WHERE c.id = v_contact
      AND c.account_id = p_account_id
      AND coalesce(c.phone, '') <> ''
      AND length(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 8
      AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 8
      AND (
        regexp_replace(c.phone, '[^0-9]', '', 'g')
          LIKE '%' || regexp_replace(p.phone, '[^0-9]', '', 'g')
        OR regexp_replace(p.phone, '[^0-9]', '', 'g')
          LIKE '%' || regexp_replace(c.phone, '[^0-9]', '', 'g')
      )
  ) THEN
    RETURN jsonb_build_object('agent_id', null, 'claimed', false);
  END IF;

  IF v_current IS NOT NULL
     AND cardinality(v_pool) > 0
     AND v_current = ANY (v_pool) THEN
    RETURN jsonb_build_object('agent_id', v_current, 'claimed', false);
  END IF;

  SELECT round_robin_enabled, round_robin_last_user_id
    INTO v_enabled, v_last
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND OR v_enabled IS NOT TRUE OR cardinality(v_pool) = 0 THEN
    RETURN jsonb_build_object('agent_id', null, 'claimed', false);
  END IF;

  v_pos := array_position(v_pool, v_last);
  IF v_pos IS NULL THEN
    v_next := v_pool[1];
  ELSIF v_pos = cardinality(v_pool) THEN
    v_next := v_pool[1];
  ELSE
    v_next := v_pool[v_pos + 1];
  END IF;

  IF v_next IS NULL THEN
    RETURN jsonb_build_object('agent_id', null, 'claimed', false);
  END IF;

  UPDATE accounts
  SET
    round_robin_last_user_id = v_next,
    updated_at = now()
  WHERE id = p_account_id;

  UPDATE conversations
  SET assigned_agent_id = v_next
  WHERE id = p_conversation_id
    AND account_id = p_account_id;

  IF v_contact IS NOT NULL THEN
    UPDATE contacts
    SET
      assigned_to = v_next,
      updated_at = now()
    WHERE id = v_contact
      AND account_id = p_account_id;
  END IF;

  RETURN jsonb_build_object('agent_id', v_next, 'claimed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_round_robin_assignment(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_round_robin_assignment(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_round_robin_assignment(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_round_robin_assignment(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_round_robin_assignment(uuid, uuid, uuid) IS
  'Assign the next round-robin advisor to a conversation, or keep the current advisor if already in the pool. Serializes concurrent inbound + AI handoff so the cursor advances once.';
