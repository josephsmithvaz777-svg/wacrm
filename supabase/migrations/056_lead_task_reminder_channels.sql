-- ============================================================
-- 056_lead_task_reminder_channels.sql
-- Track whether the due-day reminder actually left via WhatsApp
-- and/or email, so the calendar popover can show delivery status.
-- ============================================================

ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS reminder_whatsapp_at TIMESTAMPTZ;
ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS reminder_email_at TIMESTAMPTZ;
