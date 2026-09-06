-- ============================================================
-- 055_lead_task_result.sql
-- Optional completion note when an advisor marks a task done.
-- ============================================================

ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS result TEXT;
