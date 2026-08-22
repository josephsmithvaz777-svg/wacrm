-- ============================================================
-- 049_profile_phone.sql
--
-- Personal WhatsApp number for staff alerts. Automations can
-- notify the account owner and the assigned agent when a
-- customer messages, but only if that person's profile has a
-- phone. The column is nullable so existing members keep
-- working until they fill it in.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN profiles.phone IS
  'Personal WhatsApp number (digits / E.164) used for staff alert automations.';
