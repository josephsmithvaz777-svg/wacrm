import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  listAiMediaAssets: vi.fn(),
  sendMessageToConversation: vi.fn(),
  performAiHandoff: vi.fn(),
  contactBelongsToAccountStaff: vi.fn(async () => false),
  ensureSilenceHandoffLoop: vi.fn(),
  scheduleSilenceHandoffCheck: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    begin: 'claimed' as string,
    handoffAgentRole: 'agent' as string,
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./media-assets', () => ({ listAiMediaAssets: h.listAiMediaAssets }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
}))
vi.mock('./perform-handoff', () => ({
  performAiHandoff: h.performAiHandoff,
}))
vi.mock('./silence-handoff', () => ({
  ensureSilenceHandoffLoop: h.ensureSilenceHandoffLoop,
  scheduleSilenceHandoffCheck: h.scheduleSilenceHandoffCheck,
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => undefined),
}))
vi.mock('@/lib/assignments/staff-contact', () => ({
  contactBelongsToAccountStaff: h.contactBelongsToAccountStaff,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: { account_role: h.state.handoffAgentRole },
              error: null,
            }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      if (name === 'begin_ai_reply') {
        const count = Number(h.state.conv?.ai_reply_count) || 0
        const max =
          typeof args === 'object' &&
          args !== null &&
          'p_max_replies' in args
            ? Number((args as { p_max_replies: number }).p_max_replies)
            : 3
        if (count >= max) {
          return Promise.resolve({ data: 'capped', error: null })
        }
        return Promise.resolve({
          data: h.state.begin ?? 'claimed',
          error: null,
        })
      }
      if (name === 'finish_ai_reply') {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    silenceHandoffMinutes: 5,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.AI_AUTO_REPLY_PAUSE_MS = '0'
  process.env.AI_AUTO_REPLY_GAP_MS = '0'
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.begin = 'claimed'
  h.state.handoffAgentRole = 'agent'
  h.contactBelongsToAccountStaff.mockResolvedValue(false)
  h.performAiHandoff.mockResolvedValue({ claimed: true, agentId: null })
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.listAiMediaAssets.mockResolvedValue([])
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    mediaAssetId: null,
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.sendMessageToConversation.mockResolvedValue({
    messageId: 'row-1',
    whatsappMessageId: 'm1',
  })
  h.ensureSilenceHandoffLoop.mockReset()
  h.scheduleSilenceHandoffCheck.mockReset()
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual([
      'begin_ai_reply',
      'claim_ai_reply_slot',
      'finish_ai_reply',
    ])
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Hello!',
        senderType: 'bot',
        aiGenerated: true,
      }),
    )
    expect(h.scheduleSilenceHandoffCheck).toHaveBeenCalledWith({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      minutes: 5,
    })
  })

  it('arms the silence timer even when the provider throws', async () => {
    h.generateReply.mockRejectedValue(new Error('DeepSeek timeout'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.scheduleSilenceHandoffCheck).toHaveBeenCalledWith({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      minutes: 5,
    })
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('skips when the contact phone belongs to an advisor', async () => {
    h.contactBelongsToAccountStaff.mockResolvedValue(true)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls.map((c) => c.name)).toContain('claim_ai_reply_slot')
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('still replies when an advisor is assigned and the bot is not paused', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips a duplicate inbound when another reply is already in flight', async () => {
    h.state.begin = 'busy'
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('skips when the latest turn already has a bot reply', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('hands off when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.performAiHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        summary: expect.stringContaining('auto-reply cap'),
      }),
    )
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply via handoff and does not send', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.rpcCalls.map((c) => c.name)).toEqual([
      'begin_ai_reply',
      'finish_ai_reply',
    ])
    expect(h.performAiHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        alreadyAssigned: null,
      }),
    )
    const summary = h.performAiHandoff.mock.calls[0][1].summary as string
    expect(summary).toContain('AI agent handed off')
  })
})

describe('dispatchInboundToAiReply — media', () => {
  const flyer = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: 'Flyer Bosques del Sol',
    description: 'Cuando pidan información del proyecto',
    kind: 'image' as const,
    media_url: 'https://example.com/flyer.jpg',
    storage_path: 'account-x/flyer.jpg',
    filename: 'flyer.jpg',
  }

  it('sends a catalog image with the caption', async () => {
    h.listAiMediaAssets.mockResolvedValue([flyer])
    h.generateReply.mockResolvedValue({
      text: 'Te envío el flyer',
      handoff: false,
      mediaAssetId: flyer.id,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: flyer.media_url,
        contentText: 'Te envío el flyer',
        senderType: 'bot',
        aiGenerated: true,
      }),
    )
  })
})
