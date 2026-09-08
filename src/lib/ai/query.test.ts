import { describe, it, expect } from 'vitest'
import { latestUserMessage, alreadyRepliedToLatestCustomer } from './query'

describe('latestUserMessage', () => {
  it('returns the most recent user turn', () => {
    expect(
      latestUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'latest' },
      ]),
    ).toBe('latest')
  })

  it('falls back to the last message when none are user', () => {
    expect(
      latestUserMessage([{ role: 'assistant', content: 'only assistant' }]),
    ).toBe('only assistant')
  })

  it('returns empty string for no messages', () => {
    expect(latestUserMessage([])).toBe('')
  })

  it('detects when the bot already answered the latest customer turn', () => {
    expect(
      alreadyRepliedToLatestCustomer([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
    ).toBe(true)
    expect(
      alreadyRepliedToLatestCustomer([{ role: 'user', content: 'hi' }]),
    ).toBe(false)
  })
})
