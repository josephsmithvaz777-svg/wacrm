import { describe, expect, it } from 'vitest'

import { isStaleRunning, STALE_RUNNING_MS } from './pending-claim'

const now = Date.parse('2026-11-14T22:00:00.000Z')

describe('isStaleRunning', () => {
  it('reclaims a claim older than 5 minutes', () => {
    const claimed = new Date(now - STALE_RUNNING_MS - 1).toISOString()
    expect(isStaleRunning({ claimed_at: claimed, created_at: claimed }, now)).toBe(true)
  })

  it('keeps a claim that is still inside the window', () => {
    const claimed = new Date(now - STALE_RUNNING_MS).toISOString()
    expect(
      isStaleRunning(
        { claimed_at: claimed, created_at: '2026-11-01T00:00:00.000Z' },
        now,
      ),
    ).toBe(false)
  })

  it('uses created_at when the row was claimed before claimed_at existed', () => {
    expect(
      isStaleRunning(
        { claimed_at: null, created_at: '2026-11-14T21:50:00.000Z' },
        now,
      ),
    ).toBe(true)
  })
})
