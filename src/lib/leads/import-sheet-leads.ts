import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ContactError,
  findOrCreateContact,
  resolveAuditUserId,
} from '@/lib/api/v1/contacts';
import {
  assignConversationToAgent,
  claimRoundRobinAssignment,
  pickRoundRobinAgent,
} from '@/lib/assignments/round-robin';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { findOrCreateConversation } from '@/lib/conversations/find-or-create';
import { ensureInboundLeadInFunnel } from '@/lib/pipelines/inbound-deal';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

import { fetchSheetCsv, SheetFetchError } from './fetch-sheet';
import {
  formatLeadNote,
  normalizeLeadPhone,
  parseSheetCsv,
  type SheetLeadRow,
} from './sheet-csv';

export const MAX_NEW_ROWS_PER_SYNC = 100;
const SHEET_SYNC_LOOP_MS = 60_000;

export interface SheetSourceRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  spreadsheet_url: string;
  spreadsheet_id: string;
  sheet_gid: string | null;
  enabled: boolean;
  assign_round_robin: boolean;
  default_country_code: string;
  tag_name: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  last_imported_count: number;
  created_at: string;
  updated_at: string;
}

export interface SyncSourceResult {
  sourceId: string;
  imported: number;
  skipped: number;
  assigned: number;
  error?: string;
}

const syncing = new Set<string>();
let syncLoop: ReturnType<typeof setInterval> | null = null;

export function ensureSheetLeadSyncLoop(): void {
  if (syncLoop) return;
  syncLoop = setInterval(() => {
    void syncAllEnabledSheetSources().catch((err) =>
      console.error('[sheet-leads] loop failed:', err),
    );
  }, SHEET_SYNC_LOOP_MS);
}

export async function previewSheetSource(
  spreadsheetId: string,
  sheetGid: string | null,
): Promise<{ headers: string[]; rowCount: number; sampleName: string | null }> {
  const csv = await fetchSheetCsv(spreadsheetId, sheetGid);
  const parsed = parseSheetCsv(csv);
  return {
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    sampleName: parsed.rows[0]?.name ?? parsed.rows[0]?.phone ?? null,
  };
}

export async function syncAllEnabledSheetSources(
  db: SupabaseClient = supabaseAdmin(),
): Promise<SyncSourceResult[]> {
  ensureSheetLeadSyncLoop();
  const { data, error } = await db
    .from('google_sheet_sources')
    .select('*')
    .eq('enabled', true);
  if (error) {
    console.error('[sheet-leads] list sources failed:', error);
    return [];
  }
  const results: SyncSourceResult[] = [];
  for (const source of (data ?? []) as SheetSourceRow[]) {
    results.push(await syncSheetSource(db, source));
  }
  return results;
}

export async function syncSheetSourceById(
  db: SupabaseClient,
  sourceId: string,
  accountId: string,
): Promise<SyncSourceResult> {
  const { data, error } = await db
    .from('google_sheet_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) {
    return { sourceId, imported: 0, skipped: 0, assigned: 0, error: 'Fuente no encontrada' };
  }
  return syncSheetSource(db, data as SheetSourceRow);
}

async function syncSheetSource(
  db: SupabaseClient,
  source: SheetSourceRow,
): Promise<SyncSourceResult> {
  if (syncing.has(source.id)) {
    return { sourceId: source.id, imported: 0, skipped: 0, assigned: 0 };
  }
  syncing.add(source.id);

  try {
    const csv = await fetchSheetCsv(source.spreadsheet_id, source.sheet_gid);
    const parsed = parseSheetCsv(csv);
    const result = await importParsedRows(db, source, parsed.rows);
    await db
      .from('google_sheet_sources')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        last_imported_count: result.imported,
        updated_at: new Date().toISOString(),
      })
      .eq('id', source.id);
    return result;
  } catch (err) {
    const message =
      err instanceof SheetFetchError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Error al sincronizar la hoja';
    console.error('[sheet-leads] sync failed:', source.id, err);
    await db
      .from('google_sheet_sources')
      .update({
        last_error: message,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', source.id);
    return {
      sourceId: source.id,
      imported: 0,
      skipped: 0,
      assigned: 0,
      error: message,
    };
  } finally {
    syncing.delete(source.id);
  }
}

async function importParsedRows(
  db: SupabaseClient,
  source: SheetSourceRow,
  rows: SheetLeadRow[],
): Promise<SyncSourceResult> {
  const result: SyncSourceResult = {
    sourceId: source.id,
    imported: 0,
    skipped: 0,
    assigned: 0,
  };
  if (rows.length === 0) return result;

  const { data: existing } = await db
    .from('google_sheet_lead_imports')
    .select('external_id')
    .eq('source_id', source.id);
  const seen = new Set(
    ((existing ?? []) as { external_id: string }[]).map((r) => r.external_id),
  );

  const auditUserId = await resolveAuditUserId(db, source.account_id);
  let importedThisRun = 0;

  for (const row of rows) {
    if (seen.has(row.externalId)) {
      result.skipped++;
      continue;
    }
    if (importedThisRun >= MAX_NEW_ROWS_PER_SYNC) break;

    const imported = await importOneRow(db, source, row, auditUserId);
    seen.add(row.externalId);
    if (imported === 'skipped') {
      result.skipped++;
      continue;
    }
    result.imported++;
    importedThisRun++;
    if (imported === 'assigned') result.assigned++;
  }

  return result;
}

async function importOneRow(
  db: SupabaseClient,
  source: SheetSourceRow,
  row: SheetLeadRow,
  auditUserId: string,
): Promise<'assigned' | 'imported' | 'skipped'> {
  const phone = row.phone
    ? normalizeLeadPhone(row.phone, source.default_country_code || '51')
    : '';
  if (!phone || !isValidE164(phone)) {
    await recordImport(db, source, row.externalId, null, null, null);
    return 'skipped';
  }

  let contactId: string;
  let created = false;
  try {
    const found = await findOrCreateContact(db, source.account_id, auditUserId, {
      phone,
      name: row.name,
      email: row.email,
    });
    contactId = found.id;
    created = found.created;
  } catch (err) {
    if (err instanceof ContactError) {
      await recordImport(db, source, row.externalId, null, null, null);
      return 'skipped';
    }
    throw err;
  }

  if (!created) {
    await fillMissingContactFields(db, contactId, row);
  }

  await addLeadNote(db, source, contactId, auditUserId, row);
  await applyLeadTags(db, source, contactId, auditUserId, row);

  const conversationId = await findOrCreateConversation(
    db,
    source.account_id,
    auditUserId,
    contactId,
  );
  if (conversationId) {
    await db
      .from('conversations')
      .update({
        last_message_text: row.formName
          ? `Formulario: ${row.formName}`
          : 'Lead de formulario',
        last_message_at: row.createdTime || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('account_id', source.account_id);
  }

  let assignedTo: string | null = null;
  if (source.assign_round_robin && conversationId) {
    assignedTo = await assignSheetLead(db, {
      accountId: source.account_id,
      contactId,
      conversationId,
    });
  }

  await ensureInboundLeadInFunnel(db, {
    accountId: source.account_id,
    contactId,
    conversationId,
    assignedAgentId: assignedTo,
    actorUserId: auditUserId,
  });

  if (created) {
    await runAutomationsForTrigger({
      accountId: source.account_id,
      triggerType: 'new_contact_created',
      contactId,
      context: { conversation_id: conversationId ?? undefined },
    });
    await runAutomationsForTrigger({
      accountId: source.account_id,
      triggerType: 'first_inbound_message',
      contactId,
      context: {
        conversation_id: conversationId ?? undefined,
        message_text: row.formName
          ? `Formulario: ${row.formName}`
          : 'Lead de formulario',
      },
    });
  }
  if (assignedTo) {
    await runAutomationsForTrigger({
      accountId: source.account_id,
      triggerType: 'conversation_assigned',
      contactId,
      context: {
        conversation_id: conversationId ?? undefined,
        agent_id: assignedTo,
      },
    });
  }

  await recordImport(
    db,
    source,
    row.externalId,
    contactId,
    conversationId,
    assignedTo,
  );
  return assignedTo ? 'assigned' : 'imported';
}

async function assignSheetLead(
  db: SupabaseClient,
  opts: { accountId: string; contactId: string; conversationId: string },
): Promise<string | null> {
  const claim = await claimRoundRobinAssignment(db, opts);
  if (claim.agentId) return claim.agentId;

  const agentId = await pickRoundRobinAgent(db, opts.accountId);
  if (!agentId) return null;
  const assigned = await assignConversationToAgent(db, {
    ...opts,
    agentId,
  });
  return assigned ? agentId : null;
}

async function fillMissingContactFields(
  db: SupabaseClient,
  contactId: string,
  row: SheetLeadRow,
): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('name, email')
    .eq('id', contactId)
    .maybeSingle();
  if (!data) return;
  const patch: Record<string, string> = {};
  if (row.name && !String(data.name ?? '').trim()) patch.name = row.name;
  if (row.email && !String(data.email ?? '').trim()) patch.email = row.email;
  if (Object.keys(patch).length === 0) return;
  await db
    .from('contacts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', contactId);
}

async function addLeadNote(
  db: SupabaseClient,
  source: SheetSourceRow,
  contactId: string,
  userId: string,
  row: SheetLeadRow,
): Promise<void> {
  const { error } = await db.from('contact_notes').insert({
    contact_id: contactId,
    account_id: source.account_id,
    user_id: userId,
    note_text: formatLeadNote(row),
  });
  if (error) {
    console.warn('[sheet-leads] note insert failed:', error);
  }
}

async function applyLeadTags(
  db: SupabaseClient,
  source: SheetSourceRow,
  contactId: string,
  userId: string,
  row: SheetLeadRow,
): Promise<void> {
  const names = [source.tag_name, row.formName]
    .map((n) => n?.trim() ?? '')
    .filter(Boolean);
  if (names.length === 0) names.push('Formulario');

  try {
    const { tagIdByKey } = await resolveImportTagIds(db, {
      accountId: source.account_id,
      userId,
      tagNames: names,
      canCreateTags: true,
    });
    for (const tagId of tagIdByKey.values()) {
      await addContactTagAndDispatch({
        db,
        accountId: source.account_id,
        contactId,
        tagId,
      });
    }
  } catch (err) {
    console.warn('[sheet-leads] tag apply failed:', err);
  }
}

async function recordImport(
  db: SupabaseClient,
  source: SheetSourceRow,
  externalId: string,
  contactId: string | null,
  conversationId: string | null,
  assignedTo: string | null,
): Promise<void> {
  const { error } = await db.from('google_sheet_lead_imports').insert({
    account_id: source.account_id,
    source_id: source.id,
    external_id: externalId,
    contact_id: contactId,
    conversation_id: conversationId,
    assigned_to: assignedTo,
  });
  if (error && error.code !== '23505') {
    console.warn('[sheet-leads] import log failed:', error);
  }
}
