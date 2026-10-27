-- ============================================================
-- 069_google_sheet_leads.sql
--
-- Connect a Google Sheet (typically Meta Instant Forms → Sheets)
-- so new form rows become contacts, get round-robin assigned, and
-- land in the funnel. The CRM polls the published/link-shared CSV
-- export; no Google OAuth client is required.
--
-- RLS
--   Settings-class, mirroring webhook_endpoints: any member may
--   read; only admin+ may create/update/delete. The cron / sync
--   path uses the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_sheet_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                  text NOT NULL DEFAULT '',
  spreadsheet_url       text NOT NULL,
  spreadsheet_id        text NOT NULL,
  sheet_gid             text,
  enabled               boolean NOT NULL DEFAULT true,
  assign_round_robin    boolean NOT NULL DEFAULT true,
  default_country_code  text NOT NULL DEFAULT '51',
  tag_name              text,
  last_synced_at        timestamptz,
  last_error            text,
  last_imported_count   integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
);

CREATE UNIQUE INDEX IF NOT EXISTS google_sheet_sources_account_sheet_uidx
  ON google_sheet_sources (account_id, spreadsheet_id, COALESCE(sheet_gid, ''));

CREATE INDEX IF NOT EXISTS google_sheet_sources_account_id_idx
  ON google_sheet_sources (account_id);

CREATE INDEX IF NOT EXISTS google_sheet_sources_enabled_idx
  ON google_sheet_sources (account_id)
  WHERE enabled = true;

COMMENT ON TABLE google_sheet_sources IS
  'Google Sheets that dump Meta (or other) form leads into the CRM.';
COMMENT ON COLUMN google_sheet_sources.spreadsheet_id IS
  'Id from docs.google.com/spreadsheets/d/{id}/…';
COMMENT ON COLUMN google_sheet_sources.sheet_gid IS
  'Optional gid query param for a specific tab. Null = first sheet.';
COMMENT ON COLUMN google_sheet_sources.default_country_code IS
  'Digits prepended when a lead phone has no country code (e.g. 51).';

ALTER TABLE google_sheet_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_sheet_sources_select ON google_sheet_sources;
CREATE POLICY google_sheet_sources_select ON google_sheet_sources FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS google_sheet_sources_insert ON google_sheet_sources;
CREATE POLICY google_sheet_sources_insert ON google_sheet_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_sheet_sources_update ON google_sheet_sources;
CREATE POLICY google_sheet_sources_update ON google_sheet_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_sheet_sources_delete ON google_sheet_sources;
CREATE POLICY google_sheet_sources_delete ON google_sheet_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS google_sheet_lead_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_id        uuid NOT NULL REFERENCES google_sheet_sources(id) ON DELETE CASCADE,
  external_id      text NOT NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  assigned_to      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS google_sheet_lead_imports_source_idx
  ON google_sheet_lead_imports (source_id, imported_at DESC);

CREATE INDEX IF NOT EXISTS google_sheet_lead_imports_account_idx
  ON google_sheet_lead_imports (account_id);

COMMENT ON TABLE google_sheet_lead_imports IS
  'Dedup log of form-lead rows already imported from a Google Sheet.';

ALTER TABLE google_sheet_lead_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_sheet_lead_imports_select ON google_sheet_lead_imports;
CREATE POLICY google_sheet_lead_imports_select ON google_sheet_lead_imports FOR SELECT
  USING (is_account_member(account_id));

-- Writes go through the service-role cron / sync path.
DROP POLICY IF EXISTS google_sheet_lead_imports_insert ON google_sheet_lead_imports;
CREATE POLICY google_sheet_lead_imports_insert ON google_sheet_lead_imports FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
