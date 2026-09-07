import type { SupabaseClient } from '@supabase/supabase-js'

import { performAiHandoff } from './perform-handoff'

/** Default wait after the bot's last message before handing off. */
export const DEFAULT_SILENCE_HANDOFF_MINUTES = 5
export const MAX_SILENCE_HANDOFF_MINUTES = 30

export function clampSilenceHandoffMinutes(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SILENCE_HANDOFF_MINUTES
  return Math.min(MAX_SILENCE_HANDOFF_MINUTES, Math.max(0, Math.floor(n)))
}

interface SilentCandidate {
  id: string
  account_id: string
  contact_id: string
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
 * Runs from `/api/automations/cron` so one Coolify pinger covers
 * delayed automations, task reminders, and this sweep.
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

    const { data: convs, error: convErr } = await db
      .from('conversations')
      .select('id, account_id, contact_id, ai_reply_count, last_message_at')
      .eq('account_id', account.account_id)
      .is('assigned_agent_id', null)
      .eq('ai_autoreply_disabled', false)
      .lte('last_message_at', cutoff)
      .limit(30)

    if (convErr) {
      console.error('[ai silence] list conversations failed:', convErr)
      continue
    }

    for (const conv of (convs ?? []) as SilentCandidate[]) {
      const did = await maybeHandOffSilentThread(db, account, conv, cutoff)
      if (did) handedOff += 1
    }
  }

  return { handedOff }
}

async function maybeHandOffSilentThread(
  db: SupabaseClient,
  account: AccountSilenceConfig,
  conv: SilentCandidate,
  cutoffIso: string,
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

  const waitingOnBot = last.sender_type === 'customer'
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
    alreadyAssigned: null,
    summary,
    messageText,
    claimIdle: true,
  })
  return result.claimed
}
