-- ============================================================
-- 070_staff_reminders.sql
-- Internal reminders for the team (cleaning day, birthdays) that
-- can notify CRM members AND WhatsApp numbers that are not in the
-- contact book.
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  icon TEXT,
  notes TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'once'
    CHECK (recurrence IN ('once', 'weekly', 'yearly')),
  reminder_sent_at TIMESTAMPTZ,
  reminder_whatsapp_at TIMESTAMPTZ,
  reminder_email_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_reminders_due
  ON staff_reminders (due_at)
  WHERE completed_at IS NULL
    AND reminder_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_reminders_account
  ON staff_reminders (account_id, due_at);

CREATE TABLE IF NOT EXISTS staff_reminder_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL REFERENCES staff_reminders(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_reminder_recipients_target CHECK (
    user_id IS NOT NULL
    OR (phone IS NOT NULL AND length(btrim(phone)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_reminder_recipients_reminder
  ON staff_reminder_recipients (reminder_id);

ALTER TABLE staff_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_reminder_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_reminders_select ON staff_reminders;
CREATE POLICY staff_reminders_select ON staff_reminders FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS staff_reminders_insert ON staff_reminders;
CREATE POLICY staff_reminders_insert ON staff_reminders FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS staff_reminders_update ON staff_reminders;
CREATE POLICY staff_reminders_update ON staff_reminders FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS staff_reminders_delete ON staff_reminders;
CREATE POLICY staff_reminders_delete ON staff_reminders FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS staff_reminder_recipients_select ON staff_reminder_recipients;
CREATE POLICY staff_reminder_recipients_select ON staff_reminder_recipients FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS staff_reminder_recipients_insert ON staff_reminder_recipients;
CREATE POLICY staff_reminder_recipients_insert ON staff_reminder_recipients FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS staff_reminder_recipients_delete ON staff_reminder_recipients;
CREATE POLICY staff_reminder_recipients_delete ON staff_reminder_recipients FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON staff_reminders;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON staff_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_reminders TO authenticated;
GRANT ALL ON staff_reminders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_reminder_recipients TO authenticated;
GRANT ALL ON staff_reminder_recipients TO service_role;

DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'notifications'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%task_reminder%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'task_reminder', 'staff_reminder'));
