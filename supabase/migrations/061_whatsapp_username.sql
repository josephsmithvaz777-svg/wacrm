-- ============================================================
-- 061_whatsapp_username.sql
--
-- WhatsApp now delivers some 1:1 chats without a phone number:
-- Linked IDs (`123@lid`) and public @usernames. Store both on the
-- contact so the inbox can show @handle and WAHA can send to the
-- JID instead of inventing a fake E.164.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_jid TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_username TEXT;

COMMENT ON COLUMN contacts.whatsapp_jid IS
  'WhatsApp chat JID used for send/receive (e.g. 123@lid or 51…@c.us).';
COMMENT ON COLUMN contacts.whatsapp_username IS
  'Public WhatsApp username without @. Null when the lead shared a phone.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_jid
  ON contacts (account_id, whatsapp_jid)
  WHERE whatsapp_jid IS NOT NULL AND length(trim(whatsapp_jid)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_username
  ON contacts (account_id, lower(whatsapp_username))
  WHERE whatsapp_username IS NOT NULL AND length(trim(whatsapp_username)) > 0;
