import { describe, expect, it } from 'vitest'
import {
  parseOlderThanDays,
  parseAgeScope,
  parseMediaKind,
  summarizeCleanup,
  beforeIsoForDays,
  beforeIsoForMonthStart,
  mimeMatchesKind,
  CLEANUP_BEFORE_MONTH,
} from './cleanup-chat-media'
import { isAccountMediaPath } from './upload-media'

describe('parseOlderThanDays', () => {
  it('allows 7 / 14 / 30 / 60 / 90', () => {
    expect(parseOlderThanDays(7)).toBe(7)
    expect(parseOlderThanDays('14')).toBe(14)
    expect(parseOlderThanDays(60)).toBe(60)
    expect(parseOlderThanDays(15)).toBeNull()
  })
})

describe('parseAgeScope', () => {
  it('accepts before_month', () => {
    expect(parseAgeScope('before_month')).toBe(CLEANUP_BEFORE_MONTH)
    expect(parseAgeScope(7)).toBe(7)
  })
})

describe('parseMediaKind', () => {
  it('accepts known kinds', () => {
    expect(parseMediaKind('video')).toBe('video')
    expect(parseMediaKind('all')).toBe('all')
    expect(parseMediaKind('gif')).toBeNull()
  })
})

describe('beforeIsoForDays', () => {
  it('subtracts whole days from now', () => {
    const now = new Date('2026-10-26T00:00:00.000Z')
    expect(beforeIsoForDays(90, now)).toBe('2026-07-28T00:00:00.000Z')
  })
})

describe('beforeIsoForMonthStart', () => {
  it('returns the first day of the UTC month', () => {
    expect(beforeIsoForMonthStart(new Date('2026-10-27T12:00:00.000Z'))).toBe(
      '2026-10-01T00:00:00.000Z',
    )
  })
})

describe('mimeMatchesKind', () => {
  it('filters by mime family', () => {
    expect(mimeMatchesKind('video/mp4', 'video')).toBe(true)
    expect(mimeMatchesKind('image/jpeg', 'video')).toBe(false)
    expect(mimeMatchesKind('application/pdf', 'document')).toBe(true)
    expect(mimeMatchesKind('audio/mpeg', 'all')).toBe(true)
  })
})

describe('summarizeCleanup', () => {
  it('counts files and bytes', () => {
    expect(
      summarizeCleanup(
        [
          { object_name: 'a', bytes: 1000, created_at: '', mime: 'video/mp4' },
          { object_name: 'b', bytes: 500, created_at: '', mime: 'image/jpeg' },
        ],
        60,
        'all',
        '2026-08-01T00:00:00.000Z',
      ),
    ).toEqual({
      age: 60,
      kind: 'all',
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
