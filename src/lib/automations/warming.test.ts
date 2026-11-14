import { describe, expect, it } from 'vitest'
import { isExternalMediaUrl, parseSendFileConfig } from './send-file'
import { clampHourlySendLimit, staggerRunAt } from './send-quota'
import { isColdTagName, isWarmingTagName, normalizeTagName } from './warming'

describe('parseSendFileConfig', () => {
  it('accepts an external image URL and ignores nothing but the URL fields', () => {
    const parsed = parseSendFileConfig({
      url: 'https://files.example.com/lotes/fachada.jpg',
      kind: 'image',
      caption: 'Mira la fachada',
      filename: '',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.url).toBe('https://files.example.com/lotes/fachada.jpg')
      expect(parsed.value.kind).toBe('image')
      expect(parsed.value.caption).toBe('Mira la fachada')
      expect(parsed.value.filename).toBeNull()
    }
  })

  it('rejects uploads, data urls, and links with a password', () => {
    expect(parseSendFileConfig({ url: '', kind: 'image' }).ok).toBe(false)
    expect(
      parseSendFileConfig({ url: 'data:image/png;base64,aaaa', kind: 'image' }).ok,
    ).toBe(false)
    expect(
      parseSendFileConfig({
        url: 'https://user:secret@files.example.com/a.pdf',
        kind: 'document',
      }).ok,
    ).toBe(false)
    expect(isExternalMediaUrl('file:///tmp/a.pdf')).toBe(false)
    expect(isExternalMediaUrl('http://10.0.0.5/media/a.mp4')).toBe(true)
  })
})

describe('staggerRunAt', () => {
  it('spreads the first hour and starts the next hour after the cap', () => {
    const now = Date.parse('2026-11-14T15:00:00.000Z')
    expect(staggerRunAt(0, 40, now, 0)).toBe('2026-11-14T15:00:00.000Z')
    expect(staggerRunAt(1, 40, now, 0)).toBe('2026-11-14T15:01:30.000Z')
    expect(staggerRunAt(40, 40, now, 0)).toBe('2026-11-14T16:00:00.000Z')
  })

  it('clamps the hourly limit to an integer in range', () => {
    expect(clampHourlySendLimit(40)).toBe(40)
    expect(clampHourlySendLimit(0)).toBeNull()
    expect(clampHourlySendLimit(501)).toBeNull()
    expect(clampHourlySendLimit(12.5)).toBeNull()
  })
})

describe('warming tag names', () => {
  it('matches calentamiento and frío with or without accent', () => {
    expect(isWarmingTagName('Calentamiento')).toBe(true)
    expect(isWarmingTagName('calentamiento ')).toBe(true)
    expect(isColdTagName('Frío')).toBe(true)
    expect(isColdTagName('frio')).toBe(true)
    expect(normalizeTagName('Frío')).toBe('frio')
    expect(isWarmingTagName('interesado')).toBe(false)
  })
})
