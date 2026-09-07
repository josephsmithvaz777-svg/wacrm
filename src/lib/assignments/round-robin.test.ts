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
  it('picks the next advisor in round-robin even if a preferred agent is set', async () => {
    const id = await resolveHandoffAssignee(
      dbReturning({
        accounts: { round_robin_last_user_id: 'agent-1' },
        profiles: [{ user_id: 'agent-1' }, { user_id: 'agent-2' }],
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
})
