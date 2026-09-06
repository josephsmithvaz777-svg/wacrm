import { describe, it, expect } from 'vitest'
import { kindFromMime, isAiMediaKind } from './media-assets'

describe('kindFromMime', () => {
  it('maps WhatsApp-safe types', () => {
    expect(kindFromMime('image/jpeg')).toBe('image')
    expect(kindFromMime('video/mp4')).toBe('video')
    expect(kindFromMime('audio/ogg')).toBe('audio')
    expect(kindFromMime('application/pdf')).toBe('document')
  })

  it('rejects types the chat-media bucket would not store', () => {
    expect(kindFromMime('image/gif')).toBeNull()
    expect(kindFromMime('audio/webm')).toBeNull()
  })
})

describe('isAiMediaKind', () => {
  it('accepts the four send kinds', () => {
    expect(isAiMediaKind('image')).toBe(true)
    expect(isAiMediaKind('sticker')).toBe(false)
  })
})
