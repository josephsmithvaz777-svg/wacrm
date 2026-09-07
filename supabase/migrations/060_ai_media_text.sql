-- ============================================================
-- 060_ai_media_text.sql
--
-- Cache of what the AI extracted from a WhatsApp attachment so the
-- auto-reply / draft path does not re-transcribe a voice note or
-- re-describe a photo on every inbound. Caption stays in
-- `content_text`; this column is model-generated.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_media_text TEXT;

COMMENT ON COLUMN messages.ai_media_text IS
  'Cached AI transcription (audio) or description (image) for auto-reply and drafts.';
