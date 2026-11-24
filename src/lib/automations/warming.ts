import type { SupabaseClient } from '@supabase/supabase-js'
import { priorAssignedAgentId } from '@/lib/assignments/round-robin'
import { addContactTagIfAbsent, removeContactTag } from '@/lib/contacts/tag-write'
import {
  WARMING_REPLY_ALERT_TEXT,
  notifyStaffViaWhatsApp,
} from '@/lib/automations/staff-notify'

export const WARMING_TAG_NAME = 'calentamiento'
export const COLD_TAG_NAME = 'frío'

export function normalizeTagName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function isWarmingTagName(name: string): boolean {
  return normalizeTagName(name) === 'calentamiento'
}

export function isColdTagName(name: string): boolean {
  return normalizeTagName(name) === 'frio'
}

interface TagRow {
  id: string
  name: string
}

async function listAccountTags(
  db: SupabaseClient,
  accountId: string,
): Promise<TagRow[]> {
  const { data, error } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId)
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).filter(
    (row): row is TagRow =>
      typeof row?.id === 'string' && typeof row?.name === 'string',
  )
}

export async function findTagByName(
  db: SupabaseClient,
  accountId: string,
  match: (name: string) => boolean,
): Promise<TagRow | null> {
  const tags = await listAccountTags(db, accountId)
  return tags.find((tag) => match(tag.name)) ?? null
}

/**
 * Reuse an existing tag with the same name (accent-insensitive) or
 * create it. Service role bypasses the admin-only insert policy.
 */
export async function ensureNamedTag(
  db: SupabaseClient,
  args: { accountId: string; userId: string; name: string; color: string; match: (name: string) => boolean },
): Promise<string> {
  const existing = await findTagByName(db, args.accountId, args.match)
  if (existing) return existing.id
  const { data, error } = await db
    .from('tags')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      name: args.name,
      color: args.color,
    })
    .select('id')
    .single()
  if (error || !data) {
    const raced = await findTagByName(db, args.accountId, args.match)
    if (raced) return raced.id
    throw new Error(error?.message ?? 'could not create tag')
  }
  return data.id as string
}

/**
 * Sequence finished and the contact never wrote back. Tag them frío
 * and take off calentamiento. A reply after `sinceIso` (the run's log
 * row) skips this — that contact is already being handed to the AI.
 */
export async function markColdAfterSequence(
  db: SupabaseClient,
  args: { accountId: string; userId: string; contactId: string; sinceIso: string },
): Promise<void> {
  if (await customerRepliedSince(db, args.accountId, args.contactId, args.sinceIso)) {
    return
  }
  const coldId = await ensureNamedTag(db, {
    accountId: args.accountId,
    userId: args.userId,
    name: COLD_TAG_NAME,
    color: '#64748b',
    match: isColdTagName,
  })
  await addContactTagIfAbsent(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    tagId: coldId,
  })
  await removeNamedTag(db, args.accountId, args.contactId, isWarmingTagName)
}

export async function removeNamedTag(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  match: (name: string) => boolean,
): Promise<void> {
  const tag = await findTagByName(db, accountId, match)
  if (!tag) return
  await removeContactTag(db, { accountId, contactId, tagId: tag.id })
}

/** True when this contact currently carries the calentamiento tag. */
export async function contactHasWarmingTag(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const tag = await findTagByName(db, accountId, isWarmingTagName)
  if (!tag) return false
  const { data, error } = await db
    .from('contact_tags')
    .select('id')
    .eq('contact_id', contactId)
    .eq('tag_id', tag.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

/**
 * True when the contact sent a WhatsApp message strictly after `sinceIso`.
 * Used before a wait resumes, so a reply that landed while the row was
 * queued does not get another warming message.
 */
export async function customerRepliedSince(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  sinceIso: string,
): Promise<boolean> {
  const { data: convs, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  if (error) throw new Error(error.message)
  const ids = (convs ?? [])
    .map((row) => row.id as string)
    .filter((id) => typeof id === 'string')
  if (ids.length === 0) return false
  const { count, error: msgErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('sender_type', 'customer')
    .gt('created_at', sinceIso)
  if (msgErr) throw new Error(msgErr.message)
  return (count ?? 0) > 0
}

/**
 * Inbound reply: cancel queued and in-flight waits of automations that
 * opted into "stop on reply". The running row is marked cancelled so
 * the engine loop stops at its next send or wait check. The
 * calentamiento tag comes off only when this contact actually had one
 * of those executions. The advisor who already owned the lead gets one
 * WhatsApp. Never throws — the webhook must still return 200.
 *
 * `priorAgentId` is the assignee from before this inbound's round-robin.
 * Pass null when nobody owned the lead yet (a brand-new assign already
 * has its own alert). Omit it only from the engine, which looks the
 * current owner up if it wins the cancel.
 */
export async function stopWarmingOnInboundReply(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    conversationId?: string | null
    messageText?: string | null
    priorAgentId?: string | null
    usePriorAgentOnly?: boolean
  },
): Promise<void> {
  try {
    const { data: autos, error: autoErr } = await db
      .from('automations')
      .select('id')
      .eq('account_id', args.accountId)
      .eq('stop_on_reply', true)
    if (autoErr) {
      console.warn('[warming] stop_on_reply lookup:', autoErr.message)
      return
    }
    if (!autos || autos.length === 0) return
    const automationIds = autos
      .map((row) => row.id as string)
      .filter((id) => typeof id === 'string')
    const { data: rows, error: pendingErr } = await db
      .from('automation_pending_executions')
      .select('id, log_id')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .in('status', ['pending', 'running'])
      .in('automation_id', automationIds)
    if (pendingErr) {
      console.warn('[warming] pending cancel:', pendingErr.message)
      return
    }
    if (!rows || rows.length === 0) return
    const ids = rows.map((row) => row.id as string)
    const { data: cancelled, error: cancelErr } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .in('id', ids)
      .in('status', ['pending', 'running'])
      .select('id, log_id')
    if (cancelErr) {
      console.warn('[warming] pending cancel:', cancelErr.message)
      return
    }
    if (!cancelled || cancelled.length === 0) return
    const logIds = cancelled
      .map((row) => row.log_id as string | null)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (logIds.length > 0) {
      await db
        .from('automation_logs')
        .update({
          status: 'partial',
          error_message: 'El contacto respondió; se detuvo la secuencia.',
        })
        .in('id', logIds)
    }
    await removeNamedTag(db, args.accountId, args.contactId, isWarmingTagName)
    await notifyPriorAgentOfWarmingReply(db, args)
  } catch (err) {
    console.warn('[warming] stop on reply failed:', err)
  }
}

async function notifyPriorAgentOfWarmingReply(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    conversationId?: string | null
    messageText?: string | null
    priorAgentId?: string | null
    usePriorAgentOnly?: boolean
  },
): Promise<void> {
  const agentId = args.usePriorAgentOnly
    ? priorAssignedAgentId(args.priorAgentId, null)
    : await resolveWarmingReplyAgent(db, args)
  if (!agentId) return
  const messageText =
    args.messageText?.trim() ||
    (await latestCustomerText(db, args.accountId, args.contactId))
  try {
    const detail = await notifyStaffViaWhatsApp({
      db,
      accountId: args.accountId,
      contactId: args.contactId,
      conversationId: null,
      assignedAgentId: agentId,
      notifyOwner: false,
      notifyAssigned: true,
      assignedMustReceiveLeads: false,
      textTemplate: WARMING_REPLY_ALERT_TEXT,
      messageText,
    })
    if (detail.startsWith('skipped')) {
      console.info('[warming] reply alert:', detail)
    }
  } catch (err) {
    console.warn('[warming] reply alert failed:', err)
  }
}

async function resolveWarmingReplyAgent(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    conversationId?: string | null
    priorAgentId?: string | null
  },
): Promise<string | null> {
  const explicit = priorAssignedAgentId(args.priorAgentId, null)
  if (explicit) return explicit
  let conversationAgent: string | null = null
  if (args.conversationId) {
    const { data } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle()
    conversationAgent =
      typeof data?.assigned_agent_id === 'string' ? data.assigned_agent_id : null
  } else {
    const { data } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .not('assigned_agent_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
    const row = Array.isArray(data) ? data[0] : data
    conversationAgent =
      typeof row?.assigned_agent_id === 'string' ? row.assigned_agent_id : null
  }
  const { data: contact } = await db
    .from('contacts')
    .select('assigned_to')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  const contactAgent =
    typeof contact?.assigned_to === 'string' ? contact.assigned_to : null
  return priorAssignedAgentId(conversationAgent, contactAgent)
}

async function latestCustomerText(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string> {
  const { data: convs, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  if (error || !convs?.length) return ''
  const ids = convs
    .map((row) => row.id as string)
    .filter((id) => typeof id === 'string')
  if (ids.length === 0) return ''
  const { data: message } = await db
    .from('messages')
    .select('content_text')
    .in('conversation_id', ids)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return typeof message?.content_text === 'string' ? message.content_text : ''
}
