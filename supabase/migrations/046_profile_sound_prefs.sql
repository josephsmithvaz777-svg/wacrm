-- ============================================================
-- 046_profile_sound_prefs.sql
-- Per-user toggles for notification + inbound message sounds.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS sound_notifications BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sound_messages BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.sound_notifications IS
  'Play a sound when the user receives an in-app notification.';
COMMENT ON COLUMN profiles.sound_messages IS
  'Play a sound when a customer sends a new inbound message.';
