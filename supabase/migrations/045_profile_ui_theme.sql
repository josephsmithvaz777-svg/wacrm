-- ============================================================
-- 045_profile_ui_theme.sql
-- Per-user accent theme + light/dark mode (follows the account
-- across devices; localStorage remains a fast cache / guest fallback).
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ui_theme TEXT,
  ADD COLUMN IF NOT EXISTS ui_mode TEXT;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_ui_theme_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_ui_theme_check
  CHECK (ui_theme IS NULL OR ui_theme IN ('violet', 'emerald', 'cobalt', 'amber', 'rose'));

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_ui_mode_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_ui_mode_check
  CHECK (ui_mode IS NULL OR ui_mode IN ('light', 'dark'));

COMMENT ON COLUMN profiles.ui_theme IS
  'Preferred accent theme id (violet/emerald/cobalt/amber/rose).';
COMMENT ON COLUMN profiles.ui_mode IS
  'Preferred color mode (light/dark).';
