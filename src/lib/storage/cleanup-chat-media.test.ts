import { describe, expect, it } from 'vitest'
import {
  parseOlderThanDays,
  summarizeCleanup,
  beforeIsoForDays,
} from './cleanup-chat-media'
import { isAccountMediaPath } from './upload-media'

describe('parseOlderThanDays', () => {
  it('allows only 30 / 60 / 90', () => {
    expect(parseOlderThanDays(60)).toBe(60)
    expect(parseOlderThanDays('90')).toBe(90)
    expect(parseOlderThanDays(15)).toBeNull()
    expect(parseOlderThanDays('all')).toBeNull()
  })
})

describe('beforeIsoForDays', () => {
  it('subtracts whole days from now', () => {
    const now = new Date('2026-10-26T00:00:00.000Z')
    expect(beforeIsoForDays(90, now)).toBe('2026-07-28T00:00:00.000Z')
  })
})

describe('summarizeCleanup', () => {
  it('counts files and bytes', () => {
    expect(
      summarizeCleanup(
        [
          { object_name: 'a', bytes: 1000, created_at: '' },
          { object_name: 'b', bytes: 500, created_at: '' },
        ],
        60,
        '2026-08-01T00:00:00.000Z',
      ),
    ).toEqual({
      olderThanDays: 60,
      before: '2026-08-01T00:00:00.000Z',
      files: 2,
      bytes: 1500,
    })
  })
})

describe('cleanup path guard', () => {
  it('refuses a path from another account', () => {
    expect(
      isAccountMediaPath(
        '11111111-2222-3333-4444-555555555555',
        'account-other/1-x.png',
      ),
    ).toBe(false)
  })
})
