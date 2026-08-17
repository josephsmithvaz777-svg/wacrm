-- ============================================================
-- 041_round_robin_assignment.sql
--
-- Account-level round-robin for new conversations + cursor state
-- used by automations assign_conversation (mode = round_robin).
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS round_robin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS round_robin_last_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN accounts.round_robin_enabled IS
  'When true, newly created inbound conversations are assigned to the next agent in rotation.';
COMMENT ON COLUMN accounts.round_robin_last_user_id IS
  'Last user_id chosen by round-robin (cursor for the next pick).';
