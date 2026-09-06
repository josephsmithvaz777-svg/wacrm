-- ============================================================
-- 058_ai_media_assets.sql
-- Catalog of flyers / video / audio / PDFs the AI agent may send.
-- Files live in the existing public `chat-media` bucket; this table
-- is the account-owned index the model sees (title + when-to-send).
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_media_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title         text NOT NULL,
  description   text,
  kind          text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document')),
  media_url     text NOT NULL,
  storage_path  text NOT NULL,
  filename      text,
  mime_type     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_media_assets_account_id_idx
  ON ai_media_assets (account_id, created_at);

ALTER TABLE ai_media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_media_assets_select ON ai_media_assets;
CREATE POLICY ai_media_assets_select ON ai_media_assets FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_media_assets_insert ON ai_media_assets;
CREATE POLICY ai_media_assets_insert ON ai_media_assets FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_assets_update ON ai_media_assets;
CREATE POLICY ai_media_assets_update ON ai_media_assets FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_media_assets_delete ON ai_media_assets;
CREATE POLICY ai_media_assets_delete ON ai_media_assets FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_media_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_media_assets_updated_at ON ai_media_assets;
CREATE TRIGGER ai_media_assets_updated_at
  BEFORE UPDATE ON ai_media_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_media_assets_updated_at();
