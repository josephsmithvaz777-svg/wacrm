import type { SupabaseClient } from '@supabase/supabase-js';

import {
  crmEventIsSendable,
  metaCrmRequest,
  type CrmEventInput,
} from './crm-events';

interface QueuedEvent {
  id: string;
  account_id: string;
  meta_lead_id: string;
  event_name: string;
  event_time: string;
  event_id: string;
  attempts: number;
}

interface CapiConfig {
  enabled: boolean;
  dataset_id: string;
  access_token: string;
  lead_event_source: string;
  test_event_code: string | null;
}

const STALE_SENDING_MS = 15 * 60 * 1000;

export async function flushMetaCrmEvents(
  db: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  try {
    await reclaimStaleSending(db);
    const { data, error } = await db
      .from('meta_crm_events')
      .select('id, account_id, meta_lead_id, event_name, event_time, event_id, attempts')
      .in('status', ['pending', 'failed'])
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error || !data?.length) {
      if (error) console.warn('[meta-capi] queue read failed:', error);
      return result;
    }

    const byAccount = new Map<string, QueuedEvent[]>();
    for (const row of data as QueuedEvent[]) {
      const list = byAccount.get(row.account_id) ?? [];
      list.push(row);
      byAccount.set(row.account_id, list);
    }

    for (const [accountId, rows] of byAccount) {
      const config = await loadConfig(db, accountId);
      if (!config?.enabled || !config.dataset_id || !config.access_token) continue;

      const fresh: QueuedEvent[] = [];
      for (const row of rows) {
        if (!crmEventIsSendable(new Date(row.event_time))) {
          await markSkipped(db, row.id);
          result.skipped++;
          continue;
        }
        fresh.push(row);
      }
      const claimed = await claimEvents(db, fresh);
      if (claimed.length === 0) continue;

      const posted = await postBatch(config, claimed, fetchImpl);
      if (posted.ok) {
        await db
          .from('meta_crm_events')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .in(
            'id',
            claimed.map((row) => row.id),
          );
        await db
          .from('meta_capi_config')
          .update({ last_error: null, last_sent_at: new Date().toISOString() })
          .eq('account_id', accountId);
        result.sent += claimed.length;
      } else {
        const message = posted.message.slice(0, 500);
        await db
          .from('meta_crm_events')
          .update({ status: 'failed', last_error: message })
          .in(
            'id',
            claimed.map((row) => row.id),
          );
        await db
          .from('meta_capi_config')
          .update({ last_error: message })
          .eq('account_id', accountId);
        result.failed += claimed.length;
      }
    }
  } catch (err) {
    console.error('[meta-capi] flush failed:', err);
  }
  return result;
}

async function reclaimStaleSending(db: SupabaseClient): Promise<void> {
  const stale = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  await db
    .from('meta_crm_events')
    .update({ status: 'pending' })
    .eq('status', 'sending')
    .lt('claimed_at', stale);
}

async function loadConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<CapiConfig | null> {
  const { data, error } = await db
    .from('meta_capi_config')
    .select('enabled, dataset_id, access_token, lead_event_source, test_event_code')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CapiConfig;
}

async function markSkipped(db: SupabaseClient, id: string): Promise<void> {
  await db
    .from('meta_crm_events')
    .update({
      status: 'skipped',
      last_error: 'El evento tiene más de 7 días; Meta ya no lo acepta',
    })
    .eq('id', id)
    .in('status', ['pending', 'failed']);
}

async function claimEvents(
  db: SupabaseClient,
  rows: QueuedEvent[],
): Promise<QueuedEvent[]> {
  const claimed: QueuedEvent[] = [];
  const claimedAt = new Date().toISOString();
  for (const row of rows) {
    const { data } = await db
      .from('meta_crm_events')
      .update({
        status: 'sending',
        attempts: (row.attempts ?? 0) + 1,
        claimed_at: claimedAt,
      })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (data) claimed.push(row);
  }
  return claimed;
}

async function postBatch(
  config: CapiConfig,
  rows: QueuedEvent[],
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; message: string }> {
  const events: CrmEventInput[] = rows.map((row) => ({
    eventName: row.event_name,
    eventTime: new Date(row.event_time),
    leadId: row.meta_lead_id,
    eventId: row.event_id,
    leadEventSource: config.lead_event_source || 'wacrm',
  }));
  const request = metaCrmRequest({
    datasetId: config.dataset_id,
    accessToken: config.access_token,
    events,
    testEventCode: config.test_event_code,
  });
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, message: metaErrorMessage(text, response.status) };
    }
    const received = readEventsReceived(text);
    if (received === 0) {
      return { ok: false, message: metaErrorMessage(text, response.status) };
    }
    return { ok: true, message: '' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de red con Meta';
    return { ok: false, message };
  }
}

function readEventsReceived(text: string): number | null {
  try {
    const json = JSON.parse(text) as { events_received?: unknown };
    return typeof json.events_received === 'number' ? json.events_received : null;
  } catch {
    return null;
  }
}

function metaErrorMessage(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string };
    };
    if (json.error?.message) return json.error.message;
  } catch {
    // Meta sometimes returns plain text.
  }
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.slice(0, 300) || `Meta respondió ${status}`;
}
