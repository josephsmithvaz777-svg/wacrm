import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_HOURLY_SEND_LIMIT,
  staggerRunAt,
} from './send-quota'
import {
  WARMING_TAG_NAME,
  ensureNamedTag,
  isWarmingTagName,
} from './warming'

export const MAX_WARMING_ENROLL = 2000

export interface EnrollResult {
  enrolled: number
  alreadyPending: number
  noPhone: number
  skipped: number
}

interface EnrollContact {
  id: string
  phone: string | null
  is_whatsapp_group?: boolean | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function ensureConversation(
  db: SupabaseClient,
  args: { accountId: string; userId: string; contactId: string },
): Promise<string | null> {
  const { data: existing, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) return null
  if (existing?.[0]?.id) return existing[0].id as string
  const { data: created, error: createErr } = await db
    .from('conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      contact_id: args.contactId,
      status: 'open',
    })
    .select('id')
    .single()
  if (!createErr && created?.id) return created.id as string
  const { data: raced } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  return (raced?.[0]?.id as string | undefined) ?? null
}

/**
 * Queue `automation` at step 0 for each contact, spaced across the
 * account's hourly send cap. Adds the calentamiento tag without
 * firing tag_added, so a tag trigger does not also start a second run.
 */
export async function enrollContactsInWarming(
  db: SupabaseClient,
  args: { accountId: string; automationId: string; contactIds: string[] },
): Promise<EnrollResult> {
  const uniqueIds = [...new Set(args.contactIds.filter((id) => typeof id === 'string' && id))]
  const result: EnrollResult = {
    enrolled: 0,
    alreadyPending: 0,
    noPhone: 0,
    skipped: 0,
  }
  if (uniqueIds.length === 0) return result

  const { data: automation, error: autoErr } = await db
    .from('automations')
    .select('id, account_id, user_id, is_active')
    .eq('id', args.automationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (autoErr || !automation) {
    throw new Error('automation not found')
  }
  if (!automation.is_active) {
    throw new Error('automation is not active')
  }

  const { data: account } = await db
    .from('accounts')
    .select('automation_hourly_send_limit')
    .eq('id', args.accountId)
    .maybeSingle()
  const perHour =
    typeof account?.automation_hourly_send_limit === 'number' &&
    account.automation_hourly_send_limit > 0
      ? account.automation_hourly_send_limit
      : DEFAULT_HOURLY_SEND_LIMIT

  const tagId = await ensureNamedTag(db, {
    accountId: args.accountId,
    userId: automation.user_id as string,
    name: WARMING_TAG_NAME,
    color: '#f59e0b',
    match: isWarmingTagName,
  })

  const pendingIds = new Set<string>()
  for (const ids of chunk(uniqueIds, 100)) {
    const { data: pending } = await db
      .from('automation_pending_executions')
      .select('contact_id')
      .eq('automation_id', automation.id)
      .in('status', ['pending', 'running'])
      .in('contact_id', ids)
    for (const row of pending ?? []) {
      if (typeof row.contact_id === 'string') pendingIds.add(row.contact_id)
    }
  }

  const contacts: EnrollContact[] = []
  for (const ids of chunk(uniqueIds, 100)) {
    const { data, error } = await db
      .from('contacts')
      .select('id, phone, is_whatsapp_group')
      .eq('account_id', args.accountId)
      .in('id', ids)
    if (error) throw new Error(error.message)
    contacts.push(...((data ?? []) as EnrollContact[]))
  }
  const byId = new Map(contacts.map((contact) => [contact.id, contact]))

  const ready: { contactId: string; conversationId: string }[] = []
  for (const id of uniqueIds) {
    const contact = byId.get(id)
    if (!contact) {
      result.skipped += 1
      continue
    }
    if (contact.is_whatsapp_group || !contact.phone?.trim()) {
      result.noPhone += 1
      continue
    }
    if (pendingIds.has(id)) {
      result.alreadyPending += 1
      continue
    }
    const conversationId = await ensureConversation(db, {
      accountId: args.accountId,
      userId: automation.user_id as string,
      contactId: id,
    })
    if (!conversationId) {
      result.skipped += 1
      continue
    }
    ready.push({ contactId: id, conversationId })
  }

  if (ready.length === 0) return result

  for (const group of chunk(ready, 100)) {
    const { error: tagErr } = await db.from('contact_tags').upsert(
      group.map((row) => ({ contact_id: row.contactId, tag_id: tagId })),
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )
    if (tagErr) throw new Error(tagErr.message)
  }

  const now = Date.now()
  const slotJitterCap = Math.min(20_000, Math.floor(3_600_000 / perHour / 4))
  let enrolled = 0
  for (const group of chunk(ready, 100)) {
    const logs = group.map((row) => ({
      automation_id: automation.id,
      account_id: args.accountId,
      user_id: automation.user_id,
      contact_id: row.contactId,
      trigger_event: 'warming_enroll',
      steps_executed: [],
      status: 'queued',
    }))
    const { data: logRows, error: logErr } = await db
      .from('automation_logs')
      .insert(logs)
      .select('id, contact_id')
    if (logErr || !logRows) throw new Error(logErr?.message ?? 'log insert failed')
    const logByContact = new Map(
      logRows.map((row) => [row.contact_id as string, row.id as string]),
    )
    const pendingRows = group.map((row) => {
      const index = enrolled
      enrolled += 1
      const jitter = Math.floor(Math.random() * (slotJitterCap + 1))
      return {
        automation_id: automation.id,
        account_id: args.accountId,
        user_id: automation.user_id,
        contact_id: row.contactId,
        log_id: logByContact.get(row.contactId) ?? null,
        parent_step_id: null,
        branch: null,
        next_step_position: 0,
        context: {
          conversation_id: row.conversationId,
          warming_enroll: true,
        },
        run_at: staggerRunAt(index, perHour, now, jitter),
        status: 'pending',
      }
    })
    const { error: pendingErr } = await db
      .from('automation_pending_executions')
      .insert(pendingRows)
    if (pendingErr) throw new Error(pendingErr.message)
  }

  result.enrolled = enrolled
  return result
}
