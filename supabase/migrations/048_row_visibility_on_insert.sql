-- ============================================================
-- 048_row_visibility_on_insert.sql
--
-- Migration 040 wrote the contact/conversation visibility rule as
-- `can_access_contact(id)` / `can_access_conversation(id)` — helpers
-- that look the row up *in its own table*. Postgres applies a SELECT
-- policy as a WITH CHECK option when a statement has a RETURNING
-- clause, and it does so *before* the row is written, so the lookup
-- finds nothing and the check fails. Every insert that asks for its
-- own row back — which is what PostgREST does for
-- `.insert(...).select()` — was rejected with 42501 for every role,
-- owner included: the contact form, CSV import, and the broadcast
-- contact creation all hit it.
--
-- The rule itself is unchanged. It now reads the row's own columns,
-- which are available before the write, so a caller can insert a row
-- they are allowed to see. The `can_access_*(id)` helpers stay: they
-- are correct for policies on *other* tables (contact_notes,
-- contact_tags, messages …), where the referenced row already exists.
-- ============================================================

-- ------------------------------------------------------------
-- Row-level predicates (no self-lookup)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION contact_row_visible(
  row_account_id UUID,
  row_created_by UUID,
  row_assigned_to UUID,
  row_contact_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(row_account_id, 'viewer')
    AND (
      -- Restriction off → any member
      NOT account_restricts_agent_contacts(row_account_id)
      -- Admins+ always see everything
      OR is_account_member(row_account_id, 'admin')
      -- Agent/viewer: own / assigned / conversation assigned to me
      OR row_created_by = auth.uid()
      OR row_assigned_to = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM conversations conv
        WHERE conv.contact_id = row_contact_id
          AND conv.assigned_agent_id = auth.uid()
      )
    );
$$;

ALTER FUNCTION contact_row_visible(UUID, UUID, UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION contact_row_visible(UUID, UUID, UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION conversation_row_visible(
  row_account_id UUID,
  row_assigned_agent_id UUID,
  row_contact_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member(row_account_id, 'viewer')
    AND (
      NOT account_restricts_agent_contacts(row_account_id)
      OR is_account_member(row_account_id, 'admin')
      OR row_assigned_agent_id = auth.uid()
      -- The contact row already exists when a conversation is written,
      -- so the id-based helper is safe here.
      OR can_access_contact(row_contact_id)
    );
$$;

ALTER FUNCTION conversation_row_visible(UUID, UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION conversation_row_visible(UUID, UUID, UUID)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- Keep the id-based helpers as thin wrappers so the rule lives in
-- exactly one place and the two forms cannot drift apart.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION can_access_contact(target_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.id = target_contact_id
      AND contact_row_visible(c.account_id, c.created_by, c.assigned_to, c.id)
  );
$$;

CREATE OR REPLACE FUNCTION can_access_conversation(target_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM conversations conv
    WHERE conv.id = target_conversation_id
      AND conversation_row_visible(
            conv.account_id,
            conv.assigned_agent_id,
            conv.contact_id
          )
  );
$$;

-- ------------------------------------------------------------
-- RLS: read policies evaluate the row, not a lookup by id
-- ------------------------------------------------------------

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (contact_row_visible(account_id, created_by, assigned_to, id));

DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (conversation_row_visible(account_id, assigned_agent_id, contact_id));
