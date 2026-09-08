import { describe, it, expect } from 'vitest'

import {
  accountHasActiveAiAutoReply,
  maybeRoundRobinAssignNewConversation,
  resolveHandoffAssignee,
} from './round-robin'

function dbReturning(
  tables: Record<string, Record<string, unknown> | Record<string, unknown>[] | null>,
) {
  const updates: string[] = []
  const db = {
    updates,
    from: (table: string) => {
      const row = tables[table]
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.eq = self
      chain.in = self
      chain.order = self
      chain.maybeSingle = async () => ({
        data: Array.isArray(row) ? row[0] ?? null : row,
        error: null,
      })
      ;(chain as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: row, error: null })
      chain.update = () => {
        updates.push(table)
        return chain
      }
      return chain
    },
  }
  return db
}

describe('accountHasActiveAiAutoReply', () => {
  it('is true only when the assistant is on, auto-reply is on, and a key exists', async () => {
    expect(
      await accountHasActiveAiAutoReply(
        dbReturning({
          ai_configs: {
            is_active: true,
            auto_reply_enabled: true,
            api_key: 'enc',
          },
        }),
        'acct',
      ),
    ).toBe(true)
    expect(
      await accountHasActiveAiAutoReply(
        dbReturning({
          ai_configs: {
            is_active: true,
            auto_reply_enabled: false,
            api_key: 'enc',
          },
        }),
        'acct',
      ),
    ).toBe(false)
    expect(
      await accountHasActiveAiAutoReply(
        dbReturning({ ai_configs: null }),
        'acct',
      ),
    ).toBe(false)
  })
})

describe('resolveHandoffAssignee', () => {
  it('picks the next advisor in round-robin even if a preferred agent is set', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: 'agent-1' },
        profiles: [{ user_id: 'agent-1', account_role: 'agent' }, { user_id: 'agent-2', account_role: 'agent' }],
      }),
      'acct',
    )
    expect(id).toBe('agent-2')
  })

  it('returns null when nobody is eligible', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: null },
        profiles: [],
      }),
      'acct',
    )
    expect(id).toBeNull()
  })

  it('includes the account owner in the handoff pool', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: null },
        profiles: [{ user_id: 'owner-1', account_role: 'owner' }],
      }),
      'acct',
    )
    expect(id).toBe('owner-1')
  })

  it('skips admin — they can watch but must never receive leads', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: null },
        profiles: [
          { user_id: 'admin-1', account_role: 'admin' },
          { user_id: 'agent-1', account_role: 'agent' },
        ],
      }),
      'acct',
    )
    expect(id).toBe('agent-1')
  })
})

describe('maybeRoundRobinAssignNewConversation', () => {
  it('does not assign when the contact phone belongs to an advisor', async () => {
    const db = dbReturning({
      contacts: { phone: '51940912791' },
      profiles: [{ phone: '+51 940 912 791' }, { phone: '51988824220' }],
      accounts: { round_robin_enabled: true, round_robin_last_user_id: null },
      ai_configs: null,
    })
    const id = await maybeRoundRobinAssignNewConversation(db, {
      accountId: 'acct',
      contactId: 'contact-jimena',
      conversationId: 'conv-1',
    })
    expect(id).toBeNull()
    expect(db.updates).toEqual([])
  })

  it('assigns a customer number to the next advisor', async () => {
    const db = dbReturning({
      contacts: { phone: '51911111111' },
      profiles: [
        { user_id: 'agent-1', phone: '51940912791', account_role: 'agent' },
        { user_id: 'agent-2', phone: '51988824220', account_role: 'agent' },
      ],
      accounts: {
        round_robin_enabled: true,
        round_robin_last_user_id: 'agent-1',
      },
      ai_configs: null,
    })
    const id = await maybeRoundRobinAssignNewConversation(db, {
      accountId: 'acct',
      contactId: 'contact-lead',
      conversationId: 'conv-2',
    })
    expect(id).toBe('agent-2')
    expect(db.updates).toContain('accounts')
    expect(db.updates).toContain('conversations')
  })

  it('assigns even while the AI auto-reply bot is qualifying the lead', async () => {
    const db = dbReturning({
      contacts: { phone: '51911111111' },
      profiles: [
        { user_id: 'agent-1', phone: '51940912791', account_role: 'agent' },
        { user_id: 'agent-2', phone: '51988824220', account_role: 'agent' },
      ],
      accounts: {
        round_robin_enabled: true,
        round_robin_last_user_id: 'agent-1',
      },
      ai_configs: {
        is_active: true,
        auto_reply_enabled: true,
        api_key: 'enc',
      },
    })
    const id = await maybeRoundRobinAssignNewConversation(db, {
      accountId: 'acct',
      contactId: 'contact-lead',
      conversationId: 'conv-ai',
    })
    expect(id).toBe('agent-2')
  })
})
