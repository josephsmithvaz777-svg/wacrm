import type { SupabaseClient } from '@supabase/supabase-js'

import { performAiHandoff } from './perform-handoff'

/** Default wait after the bot's last message before handing off. */
export const DEFAULT_SILENCE_HANDOFF_MINUTES = 5
export const MAX_SILENCE_HANDOFF_MINUTES = 30
/**
 * Do not resurrect inbox fossils. A thread whose last message is older
 * than this is a stale unassigned lead, not a live AI qualifier that
 * just went quiet.
 */
export const MAX_SILENCE_LOOKBACK_MINUTES = 45

export function clampSilenceHandoffMinutes(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SILENCE_HANDOFF_MINUTES
  return Math.min(MAX_SILENCE_HANDOFF_MINUTES, Math.max(0, Math.floor(n)))
}

interface SilentCandidate {
  id: string
  account_id: string
  contact_id: string
  assigned_agent_id?: string | null
  ai_reply_count: number
  last_message_at: string | null
}

interface AccountSilenceConfig {
  account_id: string
  silence_handoff_minutes: number
}

/**
 * Find auto-reply threads that have gone stale — the bot spoke last
 * and the customer never wrote back, or the customer is still waiting
 * for a reply — then hand them to an advisor.
 *
 * Live AI threads only: last message within MAX_SILENCE_LOOKBACK_MINUTES.
 * That includes the bot going quiet after a reply, and the customer
 * still waiting because auto-reply never sent (ai_reply_count = 0).
 * Older unassigned inbox rows are left alone.
 *
 * Runs from `/api/automations/cron` and from an in-process 60s loop so
 * Coolify does not need an extra pinger for this path.
 */
export async function sweepSilentAiConversations(
  db: SupabaseClient,
  now = new Date(),
): Promise<{ handedOff: number }> {
  const { data: configs, error: cfgErr } = await db
    .from('ai_configs')
    .select(
      'account_id, is_active, auto_reply_enabled, api_key, silence_handoff_minutes',
    )
    .eq('is_active', true)
    .eq('auto_reply_enabled', true)

  if (cfgErr) {
    console.error('[ai silence] load configs failed:', cfgErr)
    return { handedOff: 0 }
  }

  const accounts: AccountSilenceConfig[] = []
  for (const row of configs ?? []) {
    if (!row.api_key) continue
    const minutes = clampSilenceHandoffMinutes(row.silence_handoff_minutes)
    if (minutes <= 0) continue
    accounts.push({
      account_id: row.account_id as string,
      silence_handoff_minutes: minutes,
    })
  }
  if (accounts.length === 0) return { handedOff: 0 }

  let handedOff = 0
  for (const account of accounts) {
    const cutoff = new Date(
      now.getTime() - account.silence_handoff_minutes * 60_000,
    ).toISOString()
    const floor = new Date(
      now.getTime() - MAX_SILENCE_LOOKBACK_MINUTES * 60_000,
    ).toISOString()

    const { data: convs, error: convErr } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, assigned_agent_id, ai_reply_count, last_message_at',
      )
      .eq('account_id', account.account_id)
      .eq('ai_autoreply_disabled', false)
      .lte('last_message_at', cutoff)
      .gte('last_message_at', floor)
      .limit(30)

    if (convErr) {
      console.error('[ai silence] list conversations failed:', convErr)
      continue
    }

    for (const conv of (convs ?? []) as SilentCandidate[]) {
      const did = await maybeHandOffSilentThread(db, account, conv, cutoff, now)
      if (did) handedOff += 1
    }
  }

  return { handedOff }
}

const SILENCE_LOOP_MS = 60_000
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
let silenceLoop: ReturnType<typeof setInterval> | null = null

async function runSilenceSweep(): Promise<void> {
  try {
    const { supabaseAdmin } = await import('./admin-client')
    await sweepSilentAiConversations(supabaseAdmin())
  } catch (err) {
    console.error('[ai silence] sweep failed:', err)
  }
}

/**
 * Coolify/Docker does not ping `/api/automations/cron` by itself, so a
 * 5-minute silence handoff would never fire. Start a 60s sweep on the
 * first auto-reply of this process. Idempotent.
 */
export function ensureSilenceHandoffLoop(): void {
  if (silenceLoop) return
  silenceLoop = setInterval(() => {
    void runSilenceSweep()
  }, SILENCE_LOOP_MS)
}

/**
 * Arm (or reset) a timer for this thread so handoff happens ~`minutes`
 * after the last bot send. Checks only this conversation — never a
 * backlog sweep of old unassigned leads.
 */
export function scheduleSilenceHandoffCheck(args: {
  accountId: string
  conversationId: string
  contactId: string
  minutes: number
}): void {
  const minutes = clampSilenceHandoffMinutes(args.minutes)
  const prev = silenceTimers.get(args.conversationId)
  if (prev) clearTimeout(prev)
  if (minutes <= 0) {
    silenceTimers.delete(args.conversationId)
    return
  }
  ensureSilenceHandoffLoop()
  const handle = setTimeout(() => {
    silenceTimers.delete(args.conversationId)
    void handOffConversationIfSilent(args, minutes)
  }, minutes * 60_000)
  silenceTimers.set(args.conversationId, handle)
}

async function handOffConversationIfSilent(
  args: { accountId: string; conversationId: string; contactId: string },
  minutes: number,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import('./admin-client')
    const db = supabaseAdmin()
    const { data: conv, error } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, assigned_agent_id, ai_reply_count, last_message_at',
      )
      .eq('id', args.conversationId)
      .maybeSingle()
    if (error || !conv) return
    const cutoff = new Date(Date.now() - minutes * 60_000).toISOString()
    await maybeHandOffSilentThread(
      db,
      { account_id: args.accountId, silence_handoff_minutes: minutes },
      conv as SilentCandidate,
      cutoff,
      new Date(),
    )
  } catch (err) {
    console.error('[ai silence] per-thread check failed:', err)
  }
}

async function maybeHandOffSilentThread(
  db: SupabaseClient,
  account: AccountSilenceConfig,
  conv: SilentCandidate,
  cutoffIso: string,
  now: Date,
): Promise<boolean> {
  const { data: last, error } = await db
    .from('messages')
    .select('sender_type, created_at, content_text')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !last) return false
  if (!last.created_at || last.created_at > cutoffIso) return false
  const floorIso = new Date(
    now.getTime() - MAX_SILENCE_LOOKBACK_MINUTES * 60_000,
  ).toISOString()
  if (last.created_at < floorIso) return false
  if (last.sender_type === 'agent') return false

  const waitingOnBot = last.sender_type === 'customer'
  const botReplied = (conv.ai_reply_count ?? 0) > 0
  // A silent customer after a bot reply, or a customer still waiting
  // because generate/send never landed. Do not assign random unassigned
  // threads the bot never owned (last message is bot with count 0 is
  // inconsistent; last message must be the customer if we never replied).
  if (!botReplied && !waitingOnBot) return false
  let messageText =
    (last.content_text as string | null | undefined)?.trim() || ''
  if (!waitingOnBot) {
    const lastCustomer = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conv.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    messageText =
      (lastCustomer.data?.content_text as string | null | undefined)?.trim() ||
      ''
  }

  const minutes = account.silence_handoff_minutes
  const summary = waitingOnBot
    ? `🤖 AI agent handed off after ${minutes} minutes without answering the customer.`
    : `🤖 AI agent handed off after ${minutes} minutes without a customer reply.`

  const result = await performAiHandoff(db, {
    accountId: account.account_id,
    conversationId: conv.id,
    contactId: conv.contact_id,
    alreadyAssigned: conv.assigned_agent_id ?? null,
    summary,
    messageText,
    claimIdle: true,
  })
  return result.claimed
}
