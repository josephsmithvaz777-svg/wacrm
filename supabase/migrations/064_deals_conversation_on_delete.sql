-- ============================================================
-- 064_deals_conversation_on_delete.sql
-- Inbox can delete a thread without losing the deal. Clear the
-- optional conversation_id instead of blocking the DELETE.
-- ============================================================

ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id)
  REFERENCES conversations(id)
  ON DELETE SET NULL;
