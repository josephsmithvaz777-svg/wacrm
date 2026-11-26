/**
 * Payload for Meta's Conversion Leads CRM integration.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration
 *
 * The event name is the CRM stage. Meta matches the event to the ad
 * lead with user_data.lead_id. custom_data.event_source must be "crm".
 */

export const META_GRAPH_VERSION = 'v21.0';

/** Meta drops Conversions API events older than 7 days. Stay inside that. */
export const META_EVENT_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000;

export const DEFAULT_LEAD_EVENT_SOURCE = 'wacrm';

export type FunnelRole = 'unspecified' | 'positive' | 'negative';

export interface CrmEventInput {
  eventName: string;
  eventTime: Date;
  leadId: string;
  eventId: string;
  leadEventSource: string;
}

export interface CrmEventBody {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'system_generated';
  user_data: { lead_id: string | number };
  custom_data: {
    event_source: 'crm';
    lead_event_source: string;
  };
}

/**
 * Meta's examples send lead_id as a JSON number. IDs that do not fit in a
 * safe integer stay strings so we don't round them.
 */
export function metaLeadIdValue(leadId: string): string | number {
  if (!/^\d{10,16}$/.test(leadId)) return leadId;
  const asNumber = Number(leadId);
  if (Number.isSafeInteger(asNumber) && String(asNumber) === leadId) return asNumber;
  return leadId;
}

/** Meta Instant Form lead ids are long digit strings. Sheet fingerprints are not. */
export function isMetaLeadId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\d{10,20}$/.test(value);
}

export function parseFunnelRole(value: unknown): FunnelRole | null {
  if (value === 'unspecified' || value === 'positive' || value === 'negative') {
    return value;
  }
  return null;
}

export function buildCrmEvent(input: CrmEventInput): CrmEventBody {
  const source = input.leadEventSource.trim().slice(0, 64) || DEFAULT_LEAD_EVENT_SOURCE;
  const name = input.eventName.trim().slice(0, 200);
  return {
    event_name: name,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: 'system_generated',
    user_data: { lead_id: metaLeadIdValue(input.leadId) },
    custom_data: {
      event_source: 'crm',
      lead_event_source: source,
    },
  };
}

export function crmEventIsSendable(eventTime: Date, now = new Date()): boolean {
  const age = now.getTime() - eventTime.getTime();
  return age >= -60_000 && age <= META_EVENT_MAX_AGE_MS;
}

export function metaCrmRequest(args: {
  datasetId: string;
  accessToken: string;
  events: CrmEventInput[];
  testEventCode?: string | null;
}): { url: string; body: Record<string, unknown> } {
  const body: Record<string, unknown> = {
    data: args.events.map(buildCrmEvent),
    access_token: args.accessToken,
  };
  const code = args.testEventCode?.trim();
  if (code) body.test_event_code = code;
  return {
    url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(args.datasetId)}/events`,
    body,
  };
}

export interface CapiConfigInput {
  enabled: boolean;
  datasetId: string;
  accessToken: string;
  leadEventSource: string;
  testEventCode: string;
}

export function parseCapiConfigInput(
  body: unknown,
): { ok: true; value: CapiConfigInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Cuerpo inválido' };
  }
  const raw = body as Record<string, unknown>;
  const datasetId = typeof raw.dataset_id === 'string' ? raw.dataset_id.trim() : '';
  if (datasetId && !/^\d{5,25}$/.test(datasetId)) {
    return { ok: false, error: 'El ID del conjunto de datos tiene que ser numérico' };
  }
  const accessToken =
    typeof raw.access_token === 'string' ? raw.access_token.trim() : '';
  if (accessToken.length > 500) {
    return { ok: false, error: 'El token es demasiado largo' };
  }
  const sourceRaw =
    typeof raw.lead_event_source === 'string' ? raw.lead_event_source.trim() : '';
  const leadEventSource = (sourceRaw || DEFAULT_LEAD_EVENT_SOURCE)
    .replace(/[\r\n]/g, ' ')
    .slice(0, 64);
  const testEventCode =
    typeof raw.test_event_code === 'string'
      ? raw.test_event_code.trim().slice(0, 32)
      : '';
  if (testEventCode && !/^[A-Za-z0-9_-]+$/.test(testEventCode)) {
    return { ok: false, error: 'El código de prueba solo admite letras, números y guiones' };
  }
  const enabled = raw.enabled === true;
  if (enabled && !datasetId) {
    return { ok: false, error: 'Falta el ID del conjunto de datos' };
  }
  return {
    ok: true,
    value: { enabled, datasetId, accessToken, leadEventSource, testEventCode },
  };
}

export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function splitContactName(name: string | null | undefined): {
  fn: string;
  ln: string;
} {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: '', ln: '' };
  return { fn: parts[0], ln: parts.slice(1).join(' ') };
}

export interface AudienceContact {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Customer-list CSV Meta Ads can upload for a lookalike or an exclusion. */
export function buildAudienceCsv(contacts: AudienceContact[]): {
  csv: string;
  rows: number;
} {
  const lines = ['email,phone,fn,ln'];
  let rows = 0;
  for (const contact of contacts) {
    const email = (contact.email ?? '').trim().toLowerCase();
    const phone = (contact.phone ?? '').replace(/\D/g, '');
    if (!email && !phone) continue;
    const { fn, ln } = splitContactName(contact.name);
    lines.push(
      [csvCell(email), csvCell(phone), csvCell(fn), csvCell(ln)].join(','),
    );
    rows++;
  }
  return { csv: `\uFEFF${lines.join('\n')}\n`, rows };
}
