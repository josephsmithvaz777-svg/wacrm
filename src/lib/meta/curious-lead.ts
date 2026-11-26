/**
 * Instant-form answers that mean "just looking". Those leads are tagged
 * so a warming automation can pick them up, and Meta is told they are
 * not a quality lead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { ensureNamedTag, normalizeTagName } from '@/lib/automations/warming';

import { enqueueCrmEventForContact } from './lead-links';

export const CURIOUS_TAG_NAME = 'Solo quiere conocer';
export const CURIOUS_EVENT_NAME = 'Solo quiere conocer';
export const CURIOUS_EVENT_SUFFIX = 'curious';

export function isCuriousTagName(name: string): boolean {
  return normalizeTagName(name) === normalizeTagName(CURIOUS_TAG_NAME);
}

export function isCuriousLeadAnswer(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!normalized) return false;
  return (
    normalized.includes('solo quiero conocer') ||
    normalized.includes('solo conocer') ||
    normalized.includes('quiero conocer el proyecto') ||
    normalized.includes('solo informacion')
  );
}

export function rowHasCuriousAnswer(row: {
  extras?: Record<string, string>;
  raw?: Record<string, string>;
}): boolean {
  const values = [
    ...Object.values(row.extras ?? {}),
    ...Object.values(row.raw ?? {}),
  ];
  return values.some((value) => isCuriousLeadAnswer(value));
}

/**
 * Tag the contact and, when the pipeline has a stage marked negative,
 * move the open deal there so the stage name is what Meta receives.
 * Without a negative stage, send the event name "Solo quiere conocer"
 * for them to mark as negative in Events Manager.
 */
export async function markCuriousLead(
  db: SupabaseClient,
  args: { accountId: string; userId: string; contactId: string },
): Promise<void> {
  try {
    const tagId = await ensureNamedTag(db, {
      accountId: args.accountId,
      userId: args.userId,
      name: CURIOUS_TAG_NAME,
      color: '#f59e0b',
      match: isCuriousTagName,
    });
    await addContactTagAndDispatch({
      db,
      accountId: args.accountId,
      contactId: args.contactId,
      tagId,
    });
  } catch (err) {
    console.warn('[meta] curious tag failed:', err);
  }

  try {
    const moved = await moveOpenDealToNegativeStage(db, args);
    if (moved) return;
    await enqueueCrmEventForContact(db, {
      accountId: args.accountId,
      contactId: args.contactId,
      eventName: CURIOUS_EVENT_NAME,
      eventIdSuffix: CURIOUS_EVENT_SUFFIX,
    });
  } catch (err) {
    console.warn('[meta] curious stage failed:', err);
  }
}

async function moveOpenDealToNegativeStage(
  db: SupabaseClient,
  args: { accountId: string; contactId: string },
): Promise<boolean> {
  const { data: deal } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!deal?.id || !deal.pipeline_id) return false;

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', deal.pipeline_id as string)
    .eq('meta_funnel_role', 'negative')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage?.id || stage.id === deal.stage_id) return false;

  const { error } = await db
    .from('deals')
    .update({ stage_id: stage.id as string })
    .eq('id', deal.id as string)
    .eq('account_id', args.accountId);
  if (error) {
    console.warn('[meta] move to negative stage failed:', error);
    return false;
  }
  return true;
}
