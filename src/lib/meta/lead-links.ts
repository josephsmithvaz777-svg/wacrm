import type { SupabaseClient } from '@supabase/supabase-js';

import { isMetaLeadId } from './crm-events';

const BACKFILL_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

export async function rememberMetaLead(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; externalId: string },
): Promise<void> {
  if (!isMetaLeadId(args.externalId)) return;
  const { error } = await db.from('meta_lead_links').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    meta_lead_id: args.externalId,
  });
  if (error && error.code !== '23505') {
    console.warn('[meta] lead link failed:', error);
  }
}

export async function enqueueCrmEventForContact(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    eventName: string;
    eventIdSuffix: string;
    eventTime?: string;
    dealId?: string | null;
  },
): Promise<number> {
  const { data, error } = await db
    .from('meta_lead_links')
    .select('meta_lead_id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId);
  if (error) {
    console.warn('[meta] lead lookup failed:', error);
    return 0;
  }
  let inserted = 0;
  for (const row of data ?? []) {
    const leadId = row.meta_lead_id as string;
    if (!isMetaLeadId(leadId)) continue;
    const ok = await insertCrmEvent(db, {
      accountId: args.accountId,
      contactId: args.contactId,
      dealId: args.dealId ?? null,
      metaLeadId: leadId,
      eventName: args.eventName,
      eventId: `${leadId}:${args.eventIdSuffix}`,
      eventTime: args.eventTime,
    });
    if (ok) inserted++;
  }
  return inserted;
}

async function insertCrmEvent(
  db: SupabaseClient,
  args: {
    accountId: string;
    contactId: string;
    dealId: string | null;
    metaLeadId: string;
    eventName: string;
    eventId: string;
    eventTime?: string;
  },
): Promise<boolean> {
  const { error } = await db.from('meta_crm_events').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    deal_id: args.dealId,
    meta_lead_id: args.metaLeadId,
    event_name: args.eventName.slice(0, 200),
    event_time: args.eventTime ?? new Date().toISOString(),
    event_id: args.eventId,
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.warn('[meta] enqueue failed:', error);
  return false;
}

/**
 * Attach Meta lead ids already stored on imported sheet rows, and queue
 * the current stage when that deal moved in the last 6 days. Older
 * history is linked only: Meta rejects events older than 7 days, and
 * the next real stage change will send on its own.
 */
export async function backfillMetaLeads(
  db: SupabaseClient,
  accountId: string,
): Promise<{ linked: number; enqueued: number }> {
  const { data: imports, error } = await db
    .from('google_sheet_lead_imports')
    .select('external_id, contact_id')
    .eq('account_id', accountId)
    .not('contact_id', 'is', null)
    .limit(5000);
  if (error) {
    console.warn('[meta] backfill list failed:', error);
    return { linked: 0, enqueued: 0 };
  }

  const links: { account_id: string; contact_id: string; meta_lead_id: string }[] = [];
  const seen = new Set<string>();
  for (const row of imports ?? []) {
    const externalId = row.external_id as string;
    const contactId = row.contact_id as string | null;
    if (!contactId || !isMetaLeadId(externalId) || seen.has(externalId)) continue;
    seen.add(externalId);
    links.push({
      account_id: accountId,
      contact_id: contactId,
      meta_lead_id: externalId,
    });
  }

  for (let i = 0; i < links.length; i += 200) {
    const chunk = links.slice(i, i + 200);
    const { error: upsertError } = await db.from('meta_lead_links').upsert(chunk, {
      onConflict: 'account_id,meta_lead_id',
      ignoreDuplicates: true,
    });
    if (upsertError) console.warn('[meta] backfill upsert failed:', upsertError);
  }

  const since = new Date(Date.now() - BACKFILL_WINDOW_MS).toISOString();
  const contactIds = [...new Set(links.map((link) => link.contact_id))];
  let enqueued = 0;
  for (let i = 0; i < contactIds.length; i += 100) {
    const chunk = contactIds.slice(i, i + 100);
    const { data: deals } = await db
      .from('deals')
      .select('id, contact_id, stage_id, updated_at')
      .eq('account_id', accountId)
      .in('contact_id', chunk)
      .gte('updated_at', since);
    const stageIds = [
      ...new Set(
        (deals ?? [])
          .map((deal) => deal.stage_id as string)
          .filter((id) => typeof id === 'string'),
      ),
    ];
    const names = new Map<string, string>();
    if (stageIds.length > 0) {
      const { data: stages } = await db
        .from('pipeline_stages')
        .select('id, name')
        .in('id', stageIds);
      for (const stage of stages ?? []) {
        names.set(stage.id as string, String(stage.name ?? '').trim());
      }
    }
    for (const deal of deals ?? []) {
      const stageName = names.get(deal.stage_id as string);
      const contactId = deal.contact_id as string | null;
      if (!stageName || !contactId) continue;
      enqueued += await enqueueCrmEventForContact(db, {
        accountId,
        contactId,
        dealId: deal.id as string,
        eventName: stageName,
        eventIdSuffix: deal.stage_id as string,
        eventTime: (deal.updated_at as string | null) ?? undefined,
      });
    }
  }

  return { linked: links.length, enqueued };
}
