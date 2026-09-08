import { describe, it, expect } from 'vitest'

import {
  accountHasActiveAiAutoReply,
  autoAssignPool,
  claimRoundRobinAssignment,
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

  it('includes the account owner only when there are no agents', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: null },
        profiles: [{ user_id: 'owner-1', account_role: 'owner' }],
      }),
      'acct',
    )
    expect(id).toBe('owner-1')
  })

  it('skips the owner when at least one agent can take the lead', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: 'owner-1' },
        profiles: [
          { user_id: 'owner-1', account_role: 'owner' },
          { user_id: 'agent-1', account_role: 'agent' },
        ],
      }),
      'acct',
    )
    expect(id).toBe('agent-1')
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

  it('keeps the lead when it is already on an advisor in the pool', async () => {
    const db = dbReturning({
      contacts: { phone: '51911111111' },
      profiles: [
        { user_id: 'owner-1', phone: '51900000000', account_role: 'owner' },
        { user_id: 'agent-1', phone: '51940912791', account_role: 'agent' },
      ],
      accounts: {
        round_robin_enabled: true,
        round_robin_last_user_id: 'agent-1',
      },
    })
    const id = await maybeRoundRobinAssignNewConversation(db, {
      accountId: 'acct',
      contactId: 'contact-lead',
      conversationId: 'conv-kept',
      alreadyAssigned: 'agent-1',
    })
    expect(id).toBeNull()
    expect(db.updates).toEqual([])
  })

  it('reassigns away from the owner when agents exist', async () => {
    const db = dbReturning({
      contacts: { phone: '51911111111' },
      profiles: [
        { user_id: 'owner-1', phone: '51900000000', account_role: 'owner' },
        { user_id: 'agent-1', phone: '51940912791', account_role: 'agent' },
      ],
      accounts: {
        round_robin_enabled: true,
        round_robin_last_user_id: 'owner-1',
      },
    })
    const id = await maybeRoundRobinAssignNewConversation(db, {
      accountId: 'acct',
      contactId: 'contact-lead',
      conversationId: 'conv-owner',
      alreadyAssigned: 'owner-1',
    })
    expect(id).toBe('agent-1')
  })
})

describe('autoAssignPool', () => {
  it('uses agents only when at least one exists', () => {
    const pool = autoAssignPool([
      { user_id: 'owner-1', account_role: 'owner' },
      { user_id: 'agent-1', account_role: 'agent' },
      { user_id: 'admin-1', account_role: 'admin' },
    ])
    expect(pool.map((a) => a.user_id)).toEqual(['agent-1'])
  })

  it('falls back to the owner when there are no agents', () => {
    const pool = autoAssignPool([
      { user_id: 'owner-1', account_role: 'owner' },
      { user_id: 'admin-1', account_role: 'admin' },
    ])
    expect(pool.map((a) => a.user_id)).toEqual(['owner-1'])
  })

  it('uses numbered order then any extra advisor', () => {
    const pool = autoAssignPool([
      { user_id: 'zzzz-other', account_role: 'agent', round_robin_order: null },
      { user_id: 'jimena', account_role: 'agent', round_robin_order: 3 },
      { user_id: 'isaac', account_role: 'agent', round_robin_order: 1 },
      { user_id: 'brenda', account_role: 'agent', round_robin_order: 2 },
    ])
    expect(pool.map((a) => a.user_id)).toEqual([
      'isaac',
      'brenda',
      'jimena',
      'zzzz-other',
    ])
  })
})

describe('claimRoundRobinAssignment', () => {
  it('uses the atomic RPC and does not fall back to a second pick', async () => {
    const db = dbReturning({
      contacts: { phone: '51911111111' },
      profiles: [{ phone: '51940912791' }],
    }) as ReturnType<typeof dbReturning> & {
      rpc: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    }
    let calls = 0
    db.rpc = async (name, args) => {
      calls += 1
      expect(name).toBe('claim_round_robin_assignment')
      expect(args.p_conversation_id).toBe('conv-emilio')
      return {
        data: { agent_id: 'agent-isaac', claimed: true },
        error: null,
      }
    }
    const first = await claimRoundRobinAssignment(db, {
      accountId: 'acct',
      contactId: 'contact-emilio',
      conversationId: 'conv-emilio',
    })
    db.rpc = async () => {
      calls += 1
      return {
        data: { agent_id: 'agent-isaac', claimed: false },
        error: null,
      }
    }
    const second = await claimRoundRobinAssignment(db, {
      accountId: 'acct',
      contactId: 'contact-emilio',
      conversationId: 'conv-emilio',
    })
    expect(first).toEqual({ agentId: 'agent-isaac', claimed: true })
    expect(second).toEqual({ agentId: 'agent-isaac', claimed: false })
    expect(calls).toBe(2)
    expect(db.updates).toEqual([])
    expect(
      await maybeRoundRobinAssignNewConversation(db, {
        accountId: 'acct',
        contactId: 'contact-emilio',
        conversationId: 'conv-emilio',
      }),
    ).toBeNull()
  })
})
