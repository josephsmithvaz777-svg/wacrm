-- ============================================================
-- 040_agent_contact_scope.sql
--
-- Opt-in: when accounts.restrict_agent_contacts = true, agents and
-- viewers only see contacts they created or that are assigned to them
-- (plus conversations assigned to them). Owner/admin always see all.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS restrict_agent_contacts BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN accounts.restrict_agent_contacts IS
  'When true, agent/viewer members only see contacts they created or are assigned to.';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN contacts.created_by IS
  'Auth user who manually created the contact (NULL for inbound/API).';
COMMENT ON COLUMN contacts.assigned_to IS
  'Agent responsible for this contact; synced from conversation assignment.';

CREATE INDEX IF NOT EXISTS idx_contacts_created_by
  ON contacts (account_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to
  ON contacts (account_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

-- Backfill created_by from user_id for existing rows (best-effort).
UPDATE contacts
SET created_by = user_id
WHERE created_by IS NULL
  AND user_id IS NOT NULL;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION account_restricts_agent_contacts(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT a.restrict_agent_contacts FROM accounts a WHERE a.id = target_account_id),
    FALSE
  );
$$;

ALTER FUNCTION account_restricts_agent_contacts(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION account_restricts_agent_contacts(UUID) TO authenticated, service_role;

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
      AND is_account_member(c.account_id, 'viewer')
      AND (
        -- Restriction off → any member
        NOT account_restricts_agent_contacts(c.account_id)
        -- Admins+ always see everything
        OR is_account_member(c.account_id, 'admin')
        -- Agent/viewer: own / assigned / conversation assigned to me
        OR c.created_by = auth.uid()
        OR c.assigned_to = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM conversations conv
          WHERE conv.contact_id = c.id
            AND conv.assigned_agent_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION can_access_contact(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_access_contact(UUID) TO authenticated, service_role;

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
      AND is_account_member(conv.account_id, 'viewer')
      AND (
        NOT account_restricts_agent_contacts(conv.account_id)
        OR is_account_member(conv.account_id, 'admin')
        OR conv.assigned_agent_id = auth.uid()
        OR can_access_contact(conv.contact_id)
      )
  );
$$;

ALTER FUNCTION can_access_conversation(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION can_access_conversation(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- RLS: contacts
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (can_access_contact(id));

-- Inserts still agent+; stamp ownership in the app, and allow row if member.
DROP POLICY IF EXISTS contacts_insert ON contacts;
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (
    is_account_member(account_id, 'admin')
    OR (
      is_account_member(account_id, 'agent')
      AND can_access_contact(id)
    )
  );

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    OR (
      is_account_member(account_id, 'agent')
      AND can_access_contact(id)
    )
  );

-- ------------------------------------------------------------
-- RLS: conversations
-- ------------------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (can_access_conversation(id));

DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (
    is_account_member(account_id, 'admin')
    OR (
      is_account_member(account_id, 'agent')
      AND can_access_conversation(id)
    )
  );

-- ------------------------------------------------------------
-- RLS: messages (follow conversation access)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT
  USING (can_access_conversation(conversation_id));

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id, 'agent')
        AND can_access_conversation(c.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id, 'agent')
        AND can_access_conversation(c.id)
    )
  );

-- ------------------------------------------------------------
-- RLS: contact_notes / contact_tags via contact access
-- ------------------------------------------------------------
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT
  USING (can_access_contact(contact_id));

DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND can_access_contact(contact_id)
  );

DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT
  USING (can_access_contact(contact_id));

DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
DROP POLICY IF EXISTS contact_tags_insert ON contact_tags;
CREATE POLICY contact_tags_insert ON contact_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_tags.contact_id
        AND is_account_member(c.account_id, 'agent')
        AND can_access_contact(c.id)
    )
  );

DROP POLICY IF EXISTS contact_tags_update ON contact_tags;
CREATE POLICY contact_tags_update ON contact_tags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_tags.contact_id
        AND is_account_member(c.account_id, 'agent')
        AND can_access_contact(c.id)
    )
  );

DROP POLICY IF EXISTS contact_tags_delete ON contact_tags;
CREATE POLICY contact_tags_delete ON contact_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_tags.contact_id
        AND is_account_member(c.account_id, 'agent')
        AND can_access_contact(c.id)
    )
  );
