import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  clampSilenceHandoffMinutes,
  scheduleSilenceHandoffCheck,
  sweepSilentAiConversations,
} from './silence-handoff'

const h = vi.hoisted(() => ({
  performAiHandoff: vi.fn(),
  configs: [] as Record<string, unknown>[],
  convs: [] as Record<string, unknown>[],
  lastMessage: null as Record<string, unknown> | null,
  lastCustomer: null as Record<string, unknown> | null,
}))

vi.mock('./perform-handoff', () => ({
  performAiHandoff: h.performAiHandoff,
}))

function chainFor(table: string) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self
  chain.eq = self
  chain.is = self
  chain.gt = self
  chain.lte = self
  chain.limit = self
  chain.order = self
  chain.maybeSingle = async () => {
    if (table === 'messages') {
      const row = h.lastMessage
      h.lastMessage = h.lastCustomer
      return { data: row, error: null }
    }
    return { data: null, error: null }
  }
  chain.then = undefined
  return chain
}

function db() {
  return {
    from: (table: string) => {
      if (table === 'ai_configs') {
        const chain = chainFor(table)
        chain.eq = () => chain
        // last eq in the configs query; the promise comes from awaiting the chain
        // supabase client is thenable via the builder — we return data on the
        // terminal method used: .eq('auto_reply_enabled', true) is last, but
        // the caller awaits the builder. Make the chain thenable.
        ;(chain as { then?: unknown }).then = (
          resolve: (v: unknown) => void,
        ) => resolve({ data: h.configs, error: null })
        return chain
      }
      if (table === 'conversations') {
        const chain = chainFor(table)
        ;(chain as { then?: unknown }).then = (
          resolve: (v: unknown) => void,
        ) => resolve({ data: h.convs, error: null })
        return chain
      }
      if (table === 'messages') {
        return chainFor('messages')
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('clampSilenceHandoffMinutes', () => {
  it('defaults to 5 and clamps to 0–30', () => {
    expect(clampSilenceHandoffMinutes(undefined)).toBe(5)
    expect(clampSilenceHandoffMinutes(-1)).toBe(0)
    expect(clampSilenceHandoffMinutes(99)).toBe(30)
    expect(clampSilenceHandoffMinutes(7)).toBe(7)
  })
})

describe('scheduleSilenceHandoffCheck', () => {
  it('does not arm a timer when silence is disabled', () => {
    vi.useFakeTimers()
    scheduleSilenceHandoffCheck({ conversationId: 'c1', minutes: 0 })
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})

describe('sweepSilentAiConversations', () => {
  beforeEach(() => {
    h.performAiHandoff.mockReset()
    h.performAiHandoff.mockResolvedValue({ claimed: true, agentId: 'agent-1' })
    h.configs = [
      {
        account_id: 'acct-1',
        is_active: true,
        auto_reply_enabled: true,
        api_key: 'enc',
        handoff_agent_id: null,
        silence_handoff_minutes: 5,
      },
    ]
    h.convs = [
      {
        id: 'conv-1',
        account_id: 'acct-1',
        contact_id: 'contact-1',
        ai_reply_count: 2,
        last_message_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    h.lastMessage = {
      sender_type: 'bot',
      created_at: '2026-01-01T00:00:00.000Z',
      content_text: '¿Para qué busca el lote?',
    }
    h.lastCustomer = { content_text: 'Quiero un terreno' }
  })

  it('hands off when the bot spoke last and the wait has elapsed', async () => {
    const now = new Date('2026-01-01T00:10:00.000Z')
    const result = await sweepSilentAiConversations(db() as never, now)
    expect(result).toEqual({ handedOff: 1 })
    expect(h.performAiHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        claimIdle: true,
        messageText: 'Quiero un terreno',
      }),
    )
    expect(h.performAiHandoff.mock.calls[0][1].summary).toContain(
      '5 minutes without a customer reply',
    )
  })

  it('hands off when the customer is still waiting for a reply', async () => {
    h.lastMessage = {
      sender_type: 'customer',
      created_at: '2026-01-01T00:00:00.000Z',
      content_text: '¿Qué incluye el tour?',
    }
    const now = new Date('2026-01-01T00:10:00.000Z')
    const result = await sweepSilentAiConversations(db() as never, now)
    expect(result).toEqual({ handedOff: 1 })
    expect(h.performAiHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        claimIdle: true,
        messageText: '¿Qué incluye el tour?',
      }),
    )
    expect(h.performAiHandoff.mock.calls[0][1].summary).toContain(
      'without answering the customer',
    )
  })

  it('skips accounts with silence timeout disabled', async () => {
    h.configs[0].silence_handoff_minutes = 0
    const now = new Date('2026-01-01T00:10:00.000Z')
    const result = await sweepSilentAiConversations(db() as never, now)
    expect(result).toEqual({ handedOff: 0 })
    expect(h.performAiHandoff).not.toHaveBeenCalled()
  })
})
