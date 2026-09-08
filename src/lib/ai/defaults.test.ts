import { describe, it, expect, afterEach } from 'vitest'
import {
  buildSystemPrompt,
  HANDOFF_SENTINEL,
  aiAutoReplyPauseMs,
  aiAutoReplyGapMs,
  waitMs,
} from './defaults'

describe('buildSystemPrompt', () => {
  it('tells auto-reply to send one short WhatsApp message and not dump a pitch', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
    })
    expect(prompt).toContain('Ask at most one question')
    expect(prompt).toContain('Do not repeat facts')
    expect(prompt).toContain('Send exactly one WhatsApp message')
    expect(prompt).toContain('Do not paste the full project pitch')
    expect(prompt).toContain(HANDOFF_SENTINEL)
  })

  it('still includes the account business prompt', () => {
    const prompt = buildSystemPrompt({
      userPrompt: 'Eres el calificador de Altaterra.',
      mode: 'auto_reply',
    })
    expect(prompt).toContain('Eres el calificador de Altaterra.')
  })
})

describe('aiAutoReplyPauseMs', () => {
  const prevPause = process.env.AI_AUTO_REPLY_PAUSE_MS
  const prevGap = process.env.AI_AUTO_REPLY_GAP_MS
  afterEach(() => {
    process.env.AI_AUTO_REPLY_PAUSE_MS = prevPause
    process.env.AI_AUTO_REPLY_GAP_MS = prevGap
  })

  it('defaults to a human-paced gap and can be disabled in tests', async () => {
    process.env.AI_AUTO_REPLY_PAUSE_MS = '0'
    process.env.AI_AUTO_REPLY_GAP_MS = '0'
    expect(aiAutoReplyPauseMs()).toBe(0)
    expect(aiAutoReplyGapMs()).toBe(0)
    const started = Date.now()
    await waitMs(0)
    expect(Date.now() - started).toBeLessThan(50)
  })
})
