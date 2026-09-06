-- ============================================================
-- 054_lead_task_reminders.sql
-- Task icons, due datetime, assignee, and one-shot daily reminders.
-- Also allows in-app notifications of type task_reminder.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_tasks'
      AND column_name = 'due_at'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE lead_tasks
      ALTER COLUMN due_at TYPE TIMESTAMPTZ
      USING CASE
        WHEN due_at IS NULL THEN NULL
        ELSE (due_at::timestamp + TIME '09:00') AT TIME ZONE 'America/Lima'
      END;
  END IF;
END $$;

ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

UPDATE lead_tasks lt
SET assigned_to = COALESCE(
  (
    SELECT conv.assigned_agent_id
    FROM conversations conv
    WHERE conv.id = lt.conversation_id
  ),
  (
    SELECT c.assigned_to
    FROM contacts c
    WHERE c.id = lt.contact_id
  ),
  lt.created_by
)
WHERE assigned_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_due_reminder
  ON lead_tasks (due_at)
  WHERE completed_at IS NULL
    AND reminder_sent_at IS NULL
    AND due_at IS NOT NULL;

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
    AND pg_get_constraintdef(c.oid) LIKE '%conversation_assigned%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'task_reminder'));
