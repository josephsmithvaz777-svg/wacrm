-- ============================================================
-- 050_message_ad_context.sql
--
-- Click-to-WhatsApp Facebook/Instagram ads arrive with a creative
-- (image, headline, body, source URL) plus the customer's greeting.
-- The inbox used to store only the greeting. This column keeps the
-- ad card so agents can see which creative the lead tapped.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ad_context JSONB;

COMMENT ON COLUMN messages.ad_context IS
  'Optional Click-to-WhatsApp ad card: {source, headline, body, image_url, source_url}.';
