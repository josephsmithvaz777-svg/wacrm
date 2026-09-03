-- ============================================================
-- 051_account_notification_sound.sql
-- Admin-configurable assignment chime: enable/disable + optional
-- custom audio file (mp3/wav/ogg/m4a) stored in a public bucket.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS notification_sound_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_sound_url TEXT;

COMMENT ON COLUMN accounts.notification_sound_enabled IS
  'When false, assignment/notification chimes are silenced for every member.';
COMMENT ON COLUMN accounts.notification_sound_url IS
  'Public URL of a custom notification sound. NULL uses the built-in chime.';

-- Path: {account_id}/notify-<ts>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-sounds',
  'account-sounds',
  TRUE,
  2097152, -- 2 MB
  ARRAY[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/x-m4a',
    'audio/m4a'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account sounds are publicly readable" ON storage.objects;
CREATE POLICY "Account sounds are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'account-sounds');

DROP POLICY IF EXISTS "Admins can upload account sounds" ON storage.objects;
CREATE POLICY "Admins can upload account sounds"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'account-sounds'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Admins can update account sounds" ON storage.objects;
CREATE POLICY "Admins can update account sounds"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'account-sounds'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Admins can delete account sounds" ON storage.objects;
CREATE POLICY "Admins can delete account sounds"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'account-sounds'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );
