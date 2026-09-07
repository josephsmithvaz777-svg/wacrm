import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseProxiedMediaId,
  openaiMediaKey,
  needsMediaUnderstanding,
  transcribeAudio,
  describeImage,
  IMAGE_DESCRIBE_MODEL,
} from './understand-media'
import type { AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    silenceHandoffMinutes: 5,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseProxiedMediaId', () => {
  it('extracts the Meta media id from the inbox proxy path', () => {
    expect(parseProxiedMediaId('/api/whatsapp/media/1234567890')).toBe(
      '1234567890',
    )
  })

  it('returns null for public chat-media URLs', () => {
    expect(
      parseProxiedMediaId('https://xxx.supabase.co/storage/v1/object/public/chat-media/a.jpg'),
    ).toBeNull()
  })
})

describe('openaiMediaKey', () => {
  it('uses the chat key when the provider is OpenAI', () => {
    expect(openaiMediaKey(config())).toBe('sk-test')
  })

  it('falls back to the embeddings key for Anthropic / DeepSeek', () => {
    expect(
      openaiMediaKey(config({ provider: 'anthropic', embeddingsApiKey: 'sk-embed' })),
    ).toBe('sk-embed')
    expect(openaiMediaKey(config({ provider: 'deepseek' }))).toBeNull()
  })
})

describe('needsMediaUnderstanding', () => {
  it('only enriches uncached customer audio and images', () => {
    expect(
      needsMediaUnderstanding({
        id: '1',
        sender_type: 'customer',
        content_type: 'audio',
        content_text: null,
        media_url: '/api/whatsapp/media/1',
        ai_media_text: null,
      }),
    ).toBe(true)
    expect(
      needsMediaUnderstanding({
        id: '2',
        sender_type: 'bot',
        content_type: 'image',
        content_text: null,
        media_url: 'https://example.com/a.jpg',
        ai_media_text: null,
      }),
    ).toBe(false)
    expect(
      needsMediaUnderstanding({
        id: '3',
        sender_type: 'customer',
        content_type: 'audio',
        content_text: null,
        media_url: '/api/whatsapp/media/1',
        ai_media_text: 'ya transcrito',
      }),
    ).toBe(false)
  })
})

describe('transcribeAudio', () => {
  it('posts the file to Whisper and returns the transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  Hola, quiero un lote  ' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await transcribeAudio({
      apiKey: 'sk-test',
      bytes: Buffer.from('ogg-bytes'),
      mime: 'audio/ogg',
    })
    expect(text).toBe('Hola, quiero un lote')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('audio/transcriptions')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
    expect(opts.body).toBeInstanceOf(FormData)
  })
})

describe('describeImage', () => {
  it('uses gpt-4o-mini vision when an OpenAI key is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Foto de un DNI peruano.' } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeImage({
      config: config(),
      bytes: Buffer.from('jpeg-bytes'),
      mime: 'image/jpeg',
    })
    expect(text).toBe('Foto de un DNI peruano.')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe(IMAGE_DESCRIBE_MODEL)
    expect(body.messages[0].content[1].type).toBe('image_url')
  })

  it('uses Anthropic when there is no OpenAI key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Recibo de transferencia.' }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const text = await describeImage({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x', embeddingsApiKey: null }),
      bytes: Buffer.from('png-bytes'),
      mime: 'image/png',
    })
    expect(text).toBe('Recibo de transferencia.')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
  })
})
