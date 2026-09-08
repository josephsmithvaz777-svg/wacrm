import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { aiAutoReplyGapMs, aiAutoReplyPauseMs, buildSystemPrompt, waitMs } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage, alreadyRepliedToLatestCustomer } from './query'
import { listAiMediaAssets } from './media-assets'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { contactBelongsToAccountStaff } from '@/lib/assignments/staff-contact'
import { performAiHandoff } from './perform-handoff'
import {
  ensureSilenceHandoffLoop,
  scheduleSilenceHandoffCheck,
} from './silence-handoff'
import type { AiConfig } from './types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** WhatsApp config owner on the account. Kept on the call site. */
  configOwnerUserId: string
}

/** Pulls conversation-style docs even when the last customer line is a button tap. */
const AUTO_REPLY_STYLE_QUERY =
  'agente calificador mensajes cortos un dato por mensaje no folleto no repetir principios de conversación'

function mergeKnowledge(groups: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const text of group) {
      const key = text.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(text)
    }
  }
  return out
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - the contact phone belongs to a teammate (not a lead)
 *   - auto-reply was disabled for this conversation (prior handoff /
 *     Take over). Assignment alone does not pause the bot: the lead
 *     is owned by an advisor while the AI still qualifies.
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
    const { accountId, conversationId, contactId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return
    if (config.silenceHandoffMinutes > 0) ensureSilenceHandoffLoop()

    if (await contactBelongsToAccountStaff(db, accountId, contactId)) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.ai_autoreply_disabled) return // handed off / Take over
    // Arm the silence timer before the LLM call. If DeepSeek/OpenAI
    // hangs, throws, or the host kills `after()`, the customer is still
    // handed to an advisor after `silenceHandoffMinutes` instead of
    // sitting unassigned with a fake "AI is replying" banner.
    scheduleSilenceHandoffCheck({
      accountId,
      conversationId,
      contactId,
      minutes: config.silenceHandoffMinutes,
    })

    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // One generator per thread. Concurrent Cloud API + WAHA + retries
    // used to each claim a slot and send the same pitch three times.
    const { data: began, error: beginErr } = await db.rpc('begin_ai_reply', {
      p_conversation_id: conversationId,
      p_max_replies: config.autoReplyMaxPerConversation,
    })
    if (beginErr) {
      console.error('[ai auto-reply] begin_ai_reply failed:', beginErr)
      return
    }
    if (began === 'capped') {
      await performAiHandoff(db, {
        accountId,
        conversationId,
        contactId,
        alreadyAssigned: (conv.assigned_agent_id as string | null) ?? null,
        summary: `🤖 AI agent handed off after reaching the ${config.autoReplyMaxPerConversation} auto-reply cap.`,
        messageText: '',
      })
      return
    }
    if (began !== 'claimed') return

    try {
      await runClaimedAutoReply({
        db,
        config,
        accountId,
        conversationId,
        contactId,
        assignedAgentId: (conv.assigned_agent_id as string | null) ?? null,
        replyCount: Number(conv.ai_reply_count) || 0,
      })
    } finally {
      const { error: finishErr } = await db.rpc('finish_ai_reply', {
        p_conversation_id: conversationId,
      })
      if (finishErr) {
        console.error('[ai auto-reply] finish_ai_reply failed:', finishErr)
      }
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

async function runClaimedAutoReply(args: {
  db: SupabaseClient
  config: AiConfig
  accountId: string
  conversationId: string
  contactId: string
  assignedAgentId: string | null
  replyCount: number
}): Promise<void> {
  const {
    db,
    config,
    accountId,
    conversationId,
    contactId,
    assignedAgentId,
    replyCount,
  } = args

  const messages = await buildConversationContext(db, conversationId, {
    accountId,
    config,
  })
  if (messages.length === 0) return
  if (alreadyRepliedToLatestCustomer(messages)) return

  const userText = latestUserMessage(messages)
  const [facts, style] = await Promise.all([
    retrieveKnowledge(db, accountId, config, userText),
    retrieveKnowledge(db, accountId, config, AUTO_REPLY_STYLE_QUERY, 3),
  ])
  const knowledge = mergeKnowledge([style, facts])
  const mediaAssets = await listAiMediaAssets(db, accountId)

  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    mediaAssets,
  })

  const { text, handoff, usage, mediaAssetId } = await generateReply({
    config,
    systemPrompt,
    messages,
  })

  void logAiUsage(db, {
    accountId,
    conversationId,
    mode: 'auto_reply',
    provider: config.provider,
    model: config.model,
    usage,
  })

  if (handoff || (!text && !mediaAssetId)) {
    await performAiHandoff(db, {
      accountId,
      conversationId,
      contactId,
      alreadyAssigned: assignedAgentId,
      summary: buildHandoffSummary({
        messages,
        replyCount,
      }),
      messageText: latestUserMessage(messages) ?? '',
    })
    return
  }

  const { data: claimed, error: claimErr } = await db.rpc(
    'claim_ai_reply_slot',
    {
      conversation_id: conversationId,
      max_replies: config.autoReplyMaxPerConversation,
    },
  )
  if (claimErr) {
    console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
    return
  }
  if (claimed !== true) return

  await waitMs(aiAutoReplyPauseMs())

  const sendText = (body: string) =>
    sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: 'text',
      contentText: body,
      senderType: 'bot',
      aiGenerated: true,
    })

  const asset = mediaAssetId
    ? mediaAssets.find((a) => a.id === mediaAssetId)
    : undefined
  if (asset) {
    try {
      await sendMessageToConversation(db, accountId, {
        conversationId,
        messageType: asset.kind,
        mediaUrl: asset.media_url,
        contentText: asset.kind === 'audio' ? null : text || null,
        filename: asset.filename,
        senderType: 'bot',
        aiGenerated: true,
      })
    } catch (err) {
      console.error('[ai auto-reply] media send failed:', err)
      if (text) {
        try {
          await sendText(text)
        } catch (textErr) {
          console.error('[ai auto-reply] text fallback send failed:', textErr)
          await performAiHandoff(db, {
            accountId,
            conversationId,
            contactId,
            alreadyAssigned: assignedAgentId,
            summary:
              '🤖 AI agent handed off because the WhatsApp send failed.',
            messageText: latestUserMessage(messages) ?? '',
          })
          return
        }
        scheduleSilenceHandoffCheck({
          accountId,
          conversationId,
          contactId,
          minutes: config.silenceHandoffMinutes,
        })
      }
      return
    }
    if (asset.kind === 'audio' && text) {
      await waitMs(aiAutoReplyGapMs())
      await sendText(text)
    }
    scheduleSilenceHandoffCheck({
      accountId,
      conversationId,
      contactId,
      minutes: config.silenceHandoffMinutes,
    })
    return
  }

  if (!text) return

  try {
    await sendText(text)
    scheduleSilenceHandoffCheck({
      accountId,
      conversationId,
      contactId,
      minutes: config.silenceHandoffMinutes,
    })
  } catch (err) {
    console.error('[ai auto-reply] text send failed:', err)
    await performAiHandoff(db, {
      accountId,
      conversationId,
      contactId,
      alreadyAssigned: assignedAgentId,
      summary: '🤖 AI agent handed off because the WhatsApp send failed.',
      messageText: latestUserMessage(messages) ?? '',
    })
  }
}
