import type { SupabaseClient } from '@supabase/supabase-js';

import { isCuriousTagName } from './curious-lead';
import type { AudienceContact } from './crm-events';

export async function listAudienceContacts(
  db: SupabaseClient,
  accountId: string,
  role: 'positive' | 'negative',
): Promise<AudienceContact[]> {
  const contactIds = new Set<string>();

  const { data: pipelines } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId);
  const pipelineIds = (pipelines ?? []).map((row) => row.id as string);

  let stageIds: string[] = [];
  if (pipelineIds.length > 0) {
    const { data: stages } = await db
      .from('pipeline_stages')
      .select('id')
      .in('pipeline_id', pipelineIds)
      .eq('meta_funnel_role', role);
    stageIds = (stages ?? []).map((row) => row.id as string);
  }

  const { data: deals } = await db
    .from('deals')
    .select('contact_id, status, stage_id')
    .eq('account_id', accountId)
    .limit(5000);
  for (const deal of deals ?? []) {
    const contactId = deal.contact_id as string | null;
    if (!contactId) continue;
    const won = role === 'positive' && deal.status === 'won';
    const inRole = stageIds.includes(deal.stage_id as string);
    if (won || inRole) contactIds.add(contactId);
  }

  if (role === 'negative') {
    const { data: tags } = await db
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .limit(500);
    const curious = (tags ?? []).find(
      (tag) => typeof tag.name === 'string' && isCuriousTagName(tag.name),
    );
    if (curious?.id) {
      const { data: links } = await db
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', curious.id as string)
        .limit(5000);
      for (const link of links ?? []) {
        if (typeof link.contact_id === 'string') contactIds.add(link.contact_id);
      }
    }
    const positiveIds = await positiveContactIds(db, accountId, pipelineIds);
    for (const id of positiveIds) contactIds.delete(id);
  }

  const ids = [...contactIds];
  const contacts: AudienceContact[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await db
      .from('contacts')
      .select('name, phone, email')
      .eq('account_id', accountId)
      .in('id', chunk);
    for (const row of data ?? []) {
      contacts.push({
        name: (row.name as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        email: (row.email as string | null) ?? null,
      });
    }
  }
  return contacts;
}

async function positiveContactIds(
  db: SupabaseClient,
  accountId: string,
  pipelineIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>();
  let stageIds: string[] = [];
  if (pipelineIds.length > 0) {
    const { data: stages } = await db
      .from('pipeline_stages')
      .select('id')
      .in('pipeline_id', pipelineIds)
      .eq('meta_funnel_role', 'positive');
    stageIds = (stages ?? []).map((row) => row.id as string);
  }
  const { data: deals } = await db
    .from('deals')
    .select('contact_id, status, stage_id')
    .eq('account_id', accountId)
    .limit(5000);
  for (const deal of deals ?? []) {
    const contactId = deal.contact_id as string | null;
    if (!contactId) continue;
    if (deal.status === 'won' || stageIds.includes(deal.stage_id as string)) {
      ids.add(contactId);
    }
  }
  return ids;
}
