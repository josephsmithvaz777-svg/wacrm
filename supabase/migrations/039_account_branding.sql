-- ============================================================
-- 039_account_branding.sql
--
-- Workspace white-label: optional logo URL on accounts.
-- Company display name already lives in accounts.name.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN accounts.logo_url IS
  'Public URL for the workspace logo shown in the sidebar (white-label).';

-- Public bucket for workspace logos. Path: {account_id}/logo-<ts>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-logos',
  'account-logos',
  TRUE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account logos are publicly readable" ON storage.objects;
CREATE POLICY "Account logos are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'account-logos');

DROP POLICY IF EXISTS "Admins can upload account logos" ON storage.objects;
CREATE POLICY "Admins can upload account logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'account-logos'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Admins can update account logos" ON storage.objects;
CREATE POLICY "Admins can update account logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'account-logos'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );

DROP POLICY IF EXISTS "Admins can delete account logos" ON storage.objects;
CREATE POLICY "Admins can delete account logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'account-logos'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );
