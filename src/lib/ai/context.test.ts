import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildConversationContext,
  formatMessageForModel,
  formatAdContext,
  usefulCaption,
} from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    const rows = [
      { sender_type: 'customer', content_type: 'text', content_text: 'third' },
      { sender_type: 'agent', content_type: 'text', content_text: 'second' },
      { sender_type: 'customer', content_type: 'text', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_type: 'text', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'text', content_text: '   ' },
        { sender_type: 'customer', content_type: 'text', content_text: null },
        { sender_type: 'customer', content_type: 'text', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('includes transcribed voice notes and described images', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'bot',
          content_type: 'image',
          content_text: 'La imagen de los lotes',
        },
        {
          sender_type: 'customer',
          content_type: 'audio',
          content_text: null,
          ai_media_text: 'Quiero ver los lotes de California',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[Voice note] Quiero ver los lotes de California' },
      { role: 'assistant', content: '[Sent an image] La imagen de los lotes' },
    ])
  })
})

describe('usefulCaption', () => {
  it('strips WhatsApp placeholder captions', () => {
    expect(usefulCaption('[image]')).toBe('')
    expect(usefulCaption('[audio]')).toBe('')
    expect(usefulCaption('  Lotes California  ')).toBe('Lotes California')
  })
})

describe('formatAdContext', () => {
  it('joins headline and body', () => {
    expect(
      formatAdContext({
        source: 'facebook_ad',
        headline: 'LOTES EN PREVENTA CALIFORNIA',
        body: 'Inicial S/ 10,000',
        image_url: null,
        source_url: null,
      }),
    ).toBe(
      '[The customer tapped a Facebook ad: LOTES EN PREVENTA CALIFORNIA — Inicial S/ 10,000]',
    )
  })
})

describe('formatMessageForModel', () => {
  it('labels an untranscribed customer voice note', () => {
    expect(
      formatMessageForModel({
        sender_type: 'customer',
        content_type: 'audio',
        content_text: null,
      }),
    ).toBe('[The customer sent a voice note. The audio was not transcribed.]')
  })

  it('keeps a customer caption when the image was not described', () => {
    expect(
      formatMessageForModel({
        sender_type: 'customer',
        content_type: 'image',
        content_text: 'esta es mi dni',
      }),
    ).toBe('[The customer sent an image with caption: esta es mi dni]')
  })
})
