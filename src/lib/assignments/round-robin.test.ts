import { describe, it, expect } from 'vitest'

import {
  accountHasActiveAiAutoReply,
  resolveHandoffAssignee,
} from './round-robin'

function dbReturning(
  tables: Record<string, Record<string, unknown> | Record<string, unknown>[] | null>,
) {
  return {
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
      chain.update = () => chain
      return chain
    },
  }
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
  it('returns the preferred agent when they can receive leads', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        profiles: { account_role: 'agent' },
        accounts: { round_robin_enabled: true },
      }),
      'acct',
      'agent-7',
    )
    expect(id).toBe('agent-7')
  })

  it('skips a viewer and does not assign them', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        profiles: { account_role: 'viewer' },
        accounts: { round_robin_enabled: false },
      }),
      'acct',
      'viewer-1',
    )
    expect(id).toBeNull()
  })

  it('leaves the chat unassigned when round-robin is off and no preferred agent', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_enabled: false },
      }),
      'acct',
      null,
    )
    expect(id).toBeNull()
  })
})
