-- ============================================================
-- 074_whatsapp_groups.sql
--
-- WhatsApp groups (@g.us) used to be dropped on inbound. Persist
-- them as contacts so the inbox can show the thread, while the AI
-- auto-reply / lead funnel treat them as not-a-lead.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_whatsapp_group BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.is_whatsapp_group IS
  'True when this row is a WhatsApp group chat (@g.us), not a 1:1 lead.';

CREATE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_group
  ON contacts (account_id)
  WHERE is_whatsapp_group = true;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_display_name TEXT;

COMMENT ON COLUMN messages.sender_display_name IS
  'Push name of the group participant who sent an inbound group message. Null on 1:1 chats.';
