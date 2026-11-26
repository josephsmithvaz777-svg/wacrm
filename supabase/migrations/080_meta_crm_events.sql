-- ============================================================
-- 080_meta_crm_events.sql
--
-- Tell Meta what happened after an Instant Form lead entered the
-- CRM. Each pipeline stage change for a contact that still has a
-- Meta lead id is queued and posted to the Conversions API with
-- event_source = crm, so a Conversion Leads campaign can optimize
-- for people who actually advance.
--
-- The access token lives in meta_capi_config. That table has RLS
-- and no policies: only the service role (API routes, after an
-- admin check) can read it. Members can read the delivery log.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS meta_funnel_role text NOT NULL DEFAULT 'unspecified';

ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_meta_funnel_role_check;

ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_meta_funnel_role_check
  CHECK (meta_funnel_role IN ('unspecified', 'positive', 'negative'));

COMMENT ON COLUMN pipeline_stages.meta_funnel_role IS
  'How this stage should be read by Meta: positive (quality lead), negative (unqualified), or unspecified. The event name sent to Meta is the stage name.';

CREATE TABLE IF NOT EXISTS meta_capi_config (
  account_id          uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled             boolean NOT NULL DEFAULT false,
  dataset_id          text NOT NULL DEFAULT '',
  access_token        text NOT NULL DEFAULT '',
  lead_event_source   text NOT NULL DEFAULT 'wacrm',
  test_event_code     text,
  last_error          text,
  last_sent_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meta_capi_config IS
  'Per-account Meta Conversions API credentials for CRM stage events. Service role only.';

ALTER TABLE meta_capi_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON meta_capi_config;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON meta_capi_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS meta_lead_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  meta_lead_id  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_lead_links_account_lead_uidx UNIQUE (account_id, meta_lead_id)
);

CREATE INDEX IF NOT EXISTS meta_lead_links_contact_idx
  ON meta_lead_links (account_id, contact_id);

COMMENT ON TABLE meta_lead_links IS
  'Meta Instant Form lead id (the sheet column id) for a CRM contact. Required to match Conversions API events back to the ad lead.';

ALTER TABLE meta_lead_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_lead_links_select ON meta_lead_links;
CREATE POLICY meta_lead_links_select ON meta_lead_links FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS meta_crm_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id       uuid REFERENCES deals(id) ON DELETE SET NULL,
  meta_lead_id  text NOT NULL,
  event_name    text NOT NULL,
  event_time    timestamptz NOT NULL DEFAULT now(),
  event_id      text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts      integer NOT NULL DEFAULT 0,
  claimed_at    timestamptz,
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_crm_events_account_event_uidx UNIQUE (account_id, event_id)
);

CREATE INDEX IF NOT EXISTS meta_crm_events_pending_idx
  ON meta_crm_events (created_at)
  WHERE status IN ('pending', 'failed', 'sending');

CREATE INDEX IF NOT EXISTS meta_crm_events_account_idx
  ON meta_crm_events (account_id, created_at DESC);

COMMENT ON TABLE meta_crm_events IS
  'Queued CRM stage events for the Meta Conversions API. event_id dedupes one send per lead per stage.';

ALTER TABLE meta_crm_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_crm_events_select ON meta_crm_events;
CREATE POLICY meta_crm_events_select ON meta_crm_events FOR SELECT
  USING (is_account_member(account_id));

-- Stage changes from the board, the inbox, automations, and inbound
-- WhatsApp all land here. One event per Meta lead id linked to the
-- contact, so a person who filled the form twice still updates both.
CREATE OR REPLACE FUNCTION public.enqueue_meta_crm_stage_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_name text;
  v_lead text;
BEGIN
  IF NEW.account_id IS NULL OR NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT btrim(name) INTO v_stage_name
  FROM pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_stage_name IS NULL OR v_stage_name = '' THEN
    RETURN NEW;
  END IF;

  FOR v_lead IN
    SELECT meta_lead_id
    FROM meta_lead_links
    WHERE account_id = NEW.account_id
      AND contact_id = NEW.contact_id
  LOOP
    INSERT INTO meta_crm_events (
      account_id,
      contact_id,
      deal_id,
      meta_lead_id,
      event_name,
      event_time,
      event_id
    ) VALUES (
      NEW.account_id,
      NEW.contact_id,
      NEW.id,
      v_lead,
      left(v_stage_name, 200),
      COALESCE(NEW.updated_at, now()),
      v_lead || ':' || NEW.stage_id::text
    )
    ON CONFLICT (account_id, event_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Agents move deals, so the session role must be allowed to fire the
-- trigger. The function ignores arguments and only runs inside a
-- trigger (TG_OP); it does not accept a caller-supplied lead id.
REVOKE ALL ON FUNCTION public.enqueue_meta_crm_stage_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_meta_crm_stage_event() TO authenticated, service_role;

DROP TRIGGER IF EXISTS deals_enqueue_meta_crm_event ON deals;
CREATE TRIGGER deals_enqueue_meta_crm_event
  AFTER INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_meta_crm_stage_event();
