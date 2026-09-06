-- ============================================================
-- 053_lead_tasks.sql
-- Per-lead to-dos. Agents create/complete them from the inbox
-- sidebar, contact sheet, and the Tasks page. Viewers can read.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_account_open
  ON lead_tasks (account_id, created_at DESC)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_contact
  ON lead_tasks (contact_id, created_at DESC);

ALTER TABLE lead_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_tasks_select ON lead_tasks;
CREATE POLICY lead_tasks_select ON lead_tasks FOR SELECT
  USING (can_access_contact(contact_id));

DROP POLICY IF EXISTS lead_tasks_insert ON lead_tasks;
CREATE POLICY lead_tasks_insert ON lead_tasks FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP POLICY IF EXISTS lead_tasks_update ON lead_tasks;
CREATE POLICY lead_tasks_update ON lead_tasks FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP POLICY IF EXISTS lead_tasks_delete ON lead_tasks;
CREATE POLICY lead_tasks_delete ON lead_tasks FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP TRIGGER IF EXISTS set_updated_at ON lead_tasks;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON lead_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON lead_tasks TO authenticated;
GRANT ALL ON lead_tasks TO service_role;
