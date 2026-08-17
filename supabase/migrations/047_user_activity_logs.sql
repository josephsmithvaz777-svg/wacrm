-- ============================================================
-- 047_user_activity_logs.sql
-- Audit trail of member actions. Visible to admin+ only.
-- Rows are written by SECURITY DEFINER triggers / helper.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_account_created
  ON user_activity_logs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_actor
  ON user_activity_logs (account_id, actor_user_id, created_at DESC);

ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_activity_logs_select ON user_activity_logs;
CREATE POLICY user_activity_logs_select ON user_activity_logs
  FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- No client INSERT/UPDATE/DELETE — only the helper below (triggers).
REVOKE INSERT, UPDATE, DELETE ON user_activity_logs FROM authenticated;
GRANT SELECT ON user_activity_logs TO authenticated;

CREATE OR REPLACE FUNCTION log_user_activity(
  p_account_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_summary TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF p_account_id IS NULL OR p_summary IS NULL OR length(trim(p_summary)) = 0 THEN
    RETURN;
  END IF;
  v_actor := COALESCE(p_actor_user_id, auth.uid());
  INSERT INTO user_activity_logs (
    account_id, actor_user_id, action, entity_type, entity_id, summary, metadata
  ) VALUES (
    p_account_id,
    v_actor,
    p_action,
    p_entity_type,
    p_entity_id,
    left(trim(p_summary), 500),
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION log_user_activity(UUID, TEXT, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_user_activity(UUID, TEXT, TEXT, UUID, TEXT, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION log_user_activity(UUID, TEXT, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;

CREATE OR REPLACE FUNCTION activity_actor_label()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'Sistema';
  END IF;
  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(email), ''), 'Usuario')
    INTO v_name
  FROM profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN COALESCE(v_name, 'Usuario');
END;
$$;

-- Contacts ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_contact_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
  v_name TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_name := COALESCE(NULLIF(trim(OLD.name), ''), OLD.phone, 'contacto');
    PERFORM log_user_activity(
      OLD.account_id, 'deleted', 'contact', OLD.id,
      v_label || ' eliminó el contacto ' || v_name,
      jsonb_build_object('phone', OLD.phone),
      auth.uid()
    );
    RETURN OLD;
  END IF;

  v_name := COALESCE(NULLIF(trim(NEW.name), ''), NEW.phone, 'contacto');
  IF TG_OP = 'INSERT' THEN
    PERFORM log_user_activity(
      NEW.account_id, 'created', 'contact', NEW.id,
      v_label || ' creó el contacto ' || v_name,
      jsonb_build_object('phone', NEW.phone),
      auth.uid()
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
    PERFORM log_user_activity(
      NEW.account_id, 'updated', 'contact', NEW.id,
      v_label || ' actualizó el contacto ' || v_name,
      '{}'::jsonb,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_contact_activity ON contacts;
CREATE TRIGGER trg_log_contact_activity
  AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_log_contact_activity();

-- Deals ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_deal_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
  v_title TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_title := COALESCE(NULLIF(trim(OLD.title), ''), 'deal');
    PERFORM log_user_activity(
      OLD.account_id, 'deleted', 'deal', OLD.id,
      v_label || ' eliminó el deal «' || v_title || '»',
      jsonb_build_object('status', OLD.status),
      auth.uid()
    );
    RETURN OLD;
  END IF;

  v_title := COALESCE(NULLIF(trim(NEW.title), ''), 'deal');
  IF TG_OP = 'INSERT' THEN
    PERFORM log_user_activity(
      NEW.account_id, 'created', 'deal', NEW.id,
      v_label || ' creó el deal «' || v_title || '»',
      jsonb_build_object('status', NEW.status, 'value', NEW.value),
      auth.uid()
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM log_user_activity(
        NEW.account_id, 'status_changed', 'deal', NEW.id,
        v_label || ' cambió el estado de «' || v_title || '» a ' || COALESCE(NEW.status, '—'),
        jsonb_build_object('from', OLD.status, 'to', NEW.status),
        auth.uid()
      );
    ELSIF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
      PERFORM log_user_activity(
        NEW.account_id, 'moved', 'deal', NEW.id,
        v_label || ' movió el deal «' || v_title || '» de etapa',
        jsonb_build_object('from_stage', OLD.stage_id, 'to_stage', NEW.stage_id),
        auth.uid()
      );
    ELSIF NEW IS DISTINCT FROM OLD THEN
      PERFORM log_user_activity(
        NEW.account_id, 'updated', 'deal', NEW.id,
        v_label || ' actualizó el deal «' || v_title || '»',
        '{}'::jsonb,
        auth.uid()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_deal_activity ON deals;
CREATE TRIGGER trg_log_deal_activity
  AFTER INSERT OR UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION trg_log_deal_activity();

-- Conversation assignment --------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_conversation_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
  v_contact TEXT;
BEGIN
  IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(c.name), ''), c.phone, 'contacto')
    INTO v_contact
  FROM contacts c
  WHERE c.id = NEW.contact_id;

  IF NEW.assigned_agent_id IS NULL THEN
    PERFORM log_user_activity(
      NEW.account_id, 'unassigned', 'conversation', NEW.id,
      v_label || ' desasignó la conversación con ' || COALESCE(v_contact, 'un contacto'),
      '{}'::jsonb,
      auth.uid()
    );
  ELSE
    PERFORM log_user_activity(
      NEW.account_id, 'assigned', 'conversation', NEW.id,
      v_label || ' asignó la conversación con ' || COALESCE(v_contact, 'un contacto'),
      jsonb_build_object('assigned_agent_id', NEW.assigned_agent_id),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_conversation_assign ON conversations;
CREATE TRIGGER trg_log_conversation_assign
  AFTER UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION trg_log_conversation_assign();

-- Outbound agent messages --------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_agent_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
  v_account UUID;
  v_contact TEXT;
  v_preview TEXT;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'agent' THEN
    RETURN NEW;
  END IF;
  -- Skip system/webhook paths without a signed-in actor.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conv.account_id,
         COALESCE(NULLIF(trim(c.name), ''), c.phone, 'contacto')
    INTO v_account, v_contact
  FROM conversations conv
  LEFT JOIN contacts c ON c.id = conv.contact_id
  WHERE conv.id = NEW.conversation_id;

  IF v_account IS NULL THEN
    RETURN NEW;
  END IF;

  v_preview := left(COALESCE(NULLIF(trim(NEW.content_text), ''), NEW.content_type, 'mensaje'), 80);

  PERFORM log_user_activity(
    v_account, 'sent', 'message', NEW.id,
    v_label || ' envió un mensaje a ' || v_contact,
    jsonb_build_object('preview', v_preview, 'conversation_id', NEW.conversation_id),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_agent_message ON messages;
CREATE TRIGGER trg_log_agent_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION trg_log_agent_message();

-- Broadcasts ----------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_broadcast_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM log_user_activity(
      NEW.account_id, 'created', 'broadcast', NEW.id,
      v_label || ' creó la difusión «' || COALESCE(NULLIF(trim(NEW.name), ''), 'sin nombre') || '»',
      jsonb_build_object('template', NEW.template_name),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_broadcast_activity ON broadcasts;
CREATE TRIGGER trg_log_broadcast_activity
  AFTER INSERT ON broadcasts
  FOR EACH ROW EXECUTE FUNCTION trg_log_broadcast_activity();

-- Member role changes -------------------------------------------------
CREATE OR REPLACE FUNCTION trg_log_member_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := activity_actor_label();
  v_member TEXT;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.account_role IS NOT DISTINCT FROM NEW.account_role THEN
    RETURN NEW;
  END IF;

  v_member := COALESCE(NULLIF(trim(NEW.full_name), ''), NULLIF(trim(NEW.email), ''), 'miembro');

  PERFORM log_user_activity(
    NEW.account_id, 'role_changed', 'member', NEW.user_id,
    v_label || ' cambió el rol de ' || v_member || ' a ' || NEW.account_role::text,
    jsonb_build_object('from', OLD.account_role, 'to', NEW.account_role),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_member_role_change ON profiles;
CREATE TRIGGER trg_log_member_role_change
  AFTER UPDATE OF account_role ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_log_member_role_change();
