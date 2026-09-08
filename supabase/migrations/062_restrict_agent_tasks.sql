-- ============================================================
-- 062_restrict_agent_tasks.sql
--
-- Opt-in (default on): when accounts.restrict_agent_tasks = true,
-- agents and viewers only see lead_tasks assigned to them (or
-- unassigned tasks they created). Owner/admin always see all.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS restrict_agent_tasks BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN accounts.restrict_agent_tasks IS
  'When true, agent/viewer members only see tasks assigned to them.';

CREATE INDEX IF NOT EXISTS idx_lead_tasks_assigned_to
  ON lead_tasks (account_id, assigned_to);

CREATE OR REPLACE FUNCTION account_restricts_agent_tasks(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT a.restrict_agent_tasks FROM accounts a WHERE a.id = target_account_id),
    TRUE
  );
$$;

ALTER FUNCTION account_restricts_agent_tasks(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION account_restricts_agent_tasks(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION can_access_lead_task(
  row_account_id UUID,
  row_contact_id UUID,
  row_assigned_to UUID,
  row_created_by UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    can_access_contact(row_contact_id)
    AND (
      NOT account_restricts_agent_tasks(row_account_id)
      OR is_account_member(row_account_id, 'admin')
      OR row_assigned_to = auth.uid()
      OR (
        row_assigned_to IS NULL
        AND row_created_by = auth.uid()
      )
    );
$$;

ALTER FUNCTION can_access_lead_task(UUID, UUID, UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_access_lead_task(UUID, UUID, UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS lead_tasks_select ON lead_tasks;
CREATE POLICY lead_tasks_select ON lead_tasks FOR SELECT
  USING (
    can_access_lead_task(account_id, contact_id, assigned_to, created_by)
  );

DROP POLICY IF EXISTS lead_tasks_update ON lead_tasks;
CREATE POLICY lead_tasks_update ON lead_tasks FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_lead_task(account_id, contact_id, assigned_to, created_by)
  );

DROP POLICY IF EXISTS lead_tasks_delete ON lead_tasks;
CREATE POLICY lead_tasks_delete ON lead_tasks FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_lead_task(account_id, contact_id, assigned_to, created_by)
  );
