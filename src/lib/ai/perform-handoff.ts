import type { SupabaseClient } from '@supabase/supabase-js'

import { claimRoundRobinAssignment } from '@/lib/assignments/round-robin'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

export interface AiHandoffResult {
  claimed: boolean
  agentId: string | null
}

/**
 * Pause the auto-reply bot on a thread and assign it to the next
 * advisor in round-robin. Used both when the model emits [[HANDOFF]]
 * and when the customer goes silent after a bot reply.
 *
 * `claimIdle` is for the silence sweep: the disable-bot write only
 * lands if the bot is still on, so a late Take over or a concurrent
 * handoff wins. If the lead is already on an advisor in the auto
 * pool, keep them. Owner/admin are re-routed when agents exist.
 */
export async function performAiHandoff(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    alreadyAssigned: string | null
    summary: string
    messageText: string
    claimIdle?: boolean
  },
): Promise<AiHandoffResult> {
  const baseUpdate: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.summary,
  }

  if (args.claimIdle) {
    const { data, error } = await db
      .from('conversations')
      .update(baseUpdate)
      .eq('id', args.conversationId)
      .eq('ai_autoreply_disabled', false)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai handoff] idle claim failed:', error)
      return { claimed: false, agentId: null }
    }
    if (!data) return { claimed: false, agentId: null }
  }

  let agentId: string | null = args.alreadyAssigned
  const claim = await claimRoundRobinAssignment(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    alreadyAssigned: args.alreadyAssigned,
  })
  if (claim.agentId) agentId = claim.agentId
  const newlyAssigned = claim.claimed

  if (!args.claimIdle) {
    const update = agentId
      ? { ...baseUpdate, assigned_agent_id: agentId }
      : baseUpdate
    const { error } = await db
      .from('conversations')
      .update(update)
      .eq('id', args.conversationId)
    if (error) {
      console.error('[ai handoff] conversation update failed:', error)
      return { claimed: false, agentId: null }
    }
  } else if (agentId && agentId !== args.alreadyAssigned) {
    // claimRoundRobinAssignment already wrote assigned_agent_id.
  }

  const notifyId = newlyAssigned ? agentId : null
  if (notifyId) {
    await runAutomationsForTrigger({
      accountId: args.accountId,
      triggerType: 'conversation_assigned',
      contactId: args.contactId,
      context: {
        conversation_id: args.conversationId,
        agent_id: notifyId,
        message_text: args.messageText,
      },
    })
  }

  return { claimed: true, agentId }
}
