-- ============================================================
-- WhatsApp provider: Meta Cloud API | WAHA (WhatsApp HTTP API)
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_provider_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_provider_check
      CHECK (provider IN ('meta', 'waha'));
  END IF;
END $$;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS waha_base_url TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS waha_session TEXT NOT NULL DEFAULT 'default';

COMMENT ON COLUMN whatsapp_config.provider IS
  'Transport: meta (Cloud API) or waha (self-hosted WhatsApp HTTP API).';
COMMENT ON COLUMN whatsapp_config.waha_base_url IS
  'WAHA instance origin, e.g. https://waha.example.com (no trailing slash).';
COMMENT ON COLUMN whatsapp_config.waha_session IS
  'WAHA session name used for QR + send/receive (default: default).';
