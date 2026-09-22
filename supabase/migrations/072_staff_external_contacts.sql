-- ============================================================
-- 072_staff_external_contacts.sql
-- Remember WhatsApp numbers that are not CRM leads so team
-- reminders can reuse them without typing the number again.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_external_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_external_contacts_phone_len CHECK (
    phone ~ '^[0-9]{8,13}$'
  ),
  CONSTRAINT staff_external_contacts_account_phone UNIQUE (account_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_staff_external_contacts_account
  ON staff_external_contacts (account_id, label);

ALTER TABLE staff_external_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_external_contacts_select ON staff_external_contacts;
CREATE POLICY staff_external_contacts_select ON staff_external_contacts
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS staff_external_contacts_insert ON staff_external_contacts;
CREATE POLICY staff_external_contacts_insert ON staff_external_contacts
  FOR INSERT
  WITH CHECK (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_external_contacts_update ON staff_external_contacts;
CREATE POLICY staff_external_contacts_update ON staff_external_contacts
  FOR UPDATE
  USING (can_write_staff_reminders(account_id))
  WITH CHECK (can_write_staff_reminders(account_id));

DROP POLICY IF EXISTS staff_external_contacts_delete ON staff_external_contacts;
CREATE POLICY staff_external_contacts_delete ON staff_external_contacts
  FOR DELETE
  USING (can_write_staff_reminders(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON staff_external_contacts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON staff_external_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_external_contacts TO authenticated;
GRANT ALL ON staff_external_contacts TO service_role;

INSERT INTO staff_external_contacts (account_id, label, phone)
SELECT DISTINCT ON (r.account_id, digits.phone)
  r.account_id,
  COALESCE(NULLIF(btrim(r.label), ''), digits.phone),
  digits.phone
FROM staff_reminder_recipients r
CROSS JOIN LATERAL (
  SELECT regexp_replace(COALESCE(r.phone, ''), '\D', '', 'g') AS phone
) digits
WHERE r.user_id IS NULL
  AND digits.phone ~ '^[0-9]{8,13}$'
ORDER BY r.account_id, digits.phone, r.created_at DESC
ON CONFLICT (account_id, phone) DO NOTHING;
