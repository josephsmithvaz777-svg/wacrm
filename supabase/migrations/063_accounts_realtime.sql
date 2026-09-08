-- ============================================================
-- 063_accounts_realtime.sql
-- Workspace notification-sound changes (and other account flags)
-- need to reach open dashboards without a full reload.
-- SELECT is still gated by accounts_select RLS.
--
-- The inbox chime channel no longer binds this table, so a missing
-- publication cannot silence notifications. This still lets the
-- dedicated account-sound channel pick up live mute/URL updates.
-- ============================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE accounts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
