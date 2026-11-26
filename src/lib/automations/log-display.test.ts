import { describe, expect, it } from 'vitest'

import { displayLogStatus } from './log-display'

describe('displayLogStatus', () => {
  it('shows a step-less log with a pending row as queued', () => {
    expect(displayLogStatus('failed', 0, true)).toBe('queued')
    expect(displayLogStatus('queued', 0, true)).toBe('queued')
  })

  it('keeps the stored status once steps exist or nothing is queued', () => {
    expect(displayLogStatus('failed', 0, false)).toBe('failed')
    expect(displayLogStatus('partial', 2, true)).toBe('partial')
    expect(displayLogStatus('running', 0, false)).toBe('running')
  })
})
