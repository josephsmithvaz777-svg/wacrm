import { NextResponse } from 'next/server'
import {
  agentCanReceiveLeads,
  claimRoundRobinAssignment,
} from '@/lib/assignments/round-robin'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Toggle the AI auto-reply bot for one conversation from the inbox — the
 * "Take over" / "Resume AI" banner.
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pause the bot here (a human is taking over). When
 *                     `assign_to_me` is set, assign the thread to the
 *                     caller only if they may keep a lead (agents).
 *                     Owner/admin pause the bot without taking the lead;
 *                     if the thread was on them, it moves to an advisor.
 *   - paused: false → hand the thread back to the bot: clear the pause,
 *                     reset the per-conversation reply count so it gets
 *                     fresh slots, and clear the handoff note. Keep the
 *                     current assignee so the lead stays in their inbox
 *                     while the bot talks.
 *
 * Writes go through the RLS-scoped SSR client, so a conversation outside
 * the caller's account simply isn't found (404).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    // Reuse the send bucket: this is a cheap per-user inbox action and
    // toggling it in a tight loop has no legitimate use.
    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.paused !== 'boolean') {
      return NextResponse.json(
        { error: 'paused (boolean) is required' },
        { status: 400 },
      )
    }
    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true

    // Confirm the conversation is in the caller's account before writing.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const update: Record<string, unknown> = { ai_autoreply_disabled: paused }
    let assignedAgentId =
      (conv.assigned_agent_id as string | null | undefined) ?? null
    const contactId = (conv.contact_id as string | null | undefined) ?? null

    if (paused) {
      const callerKeepsLead =
        assignToMe &&
        (await agentCanReceiveLeads(supabase, accountId, userId))
      if (callerKeepsLead) {
        update.assigned_agent_id = userId
        assignedAgentId = userId
      } else if (contactId) {
        const claim = await claimRoundRobinAssignment(supabase, {
          accountId,
          contactId,
          conversationId,
          alreadyAssigned: assignedAgentId,
        })
        if (claim.agentId) {
          assignedAgentId = claim.agentId
          update.assigned_agent_id = claim.agentId
        } else {
          update.assigned_agent_id = null
          assignedAgentId = null
        }
      } else {
        update.assigned_agent_id = null
        assignedAgentId = null
      }
    } else {
      // Keep whoever already owns the lead. The bot no longer stands
      // down just because a human is assigned.
      update.ai_reply_count = 0
      update.ai_handoff_summary = null
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      paused,
      assigned_agent_id: assignedAgentId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
