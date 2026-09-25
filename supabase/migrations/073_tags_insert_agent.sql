-- ============================================================
-- 073_tags_insert_agent.sql
-- Agents (and admin/owner) may create account tags from the
-- inbox contact panel. Update/delete stay admin-only.
-- ============================================================

DROP POLICY IF EXISTS tags_insert ON tags;
CREATE POLICY tags_insert ON tags FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
