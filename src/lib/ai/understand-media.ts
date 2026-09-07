import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { AiError, type AiConfig } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

/** WhatsApp inbound photos/voice notes are stored as this relative proxy. */
export const PROXY_MEDIA_PREFIX = '/api/whatsapp/media/'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Cheap vision model for the describe-image pass (not the account's chat model). */
export const IMAGE_DESCRIBE_MODEL = 'gpt-4o-mini'

/** DeepSeek's vision model — text models (v4-flash / chat) reject images. */
export const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp'

const AUDIO_MAX_BYTES = 25 * 1024 * 1024
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** Bound latency: only the newest uncached customer attachments. */
export const MAX_MEDIA_ENRICH_PER_TURN = 3

const ANTHROPIC_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export type MediaUnderstandKind = 'audio' | 'image'

export interface MediaContextRow {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  media_url: string | null
  ai_media_text: string | null
}

type MediaAiConfig = Pick<
  AiConfig,
  'provider' | 'apiKey' | 'model' | 'embeddingsApiKey'
>

/** OpenAI key usable for Whisper / gpt-4o-mini vision. */
export function openaiMediaKey(config: MediaAiConfig): string | null {
  if (config.provider === 'openai' && config.apiKey.trim()) return config.apiKey
  if (config.embeddingsApiKey && config.embeddingsApiKey.trim()) {
    return config.embeddingsApiKey
  }
  return null
}

export function parseProxiedMediaId(url: string): string | null {
  const path = url.trim().split('?')[0]
  if (!path.startsWith(PROXY_MEDIA_PREFIX)) return null
  const id = path.slice(PROXY_MEDIA_PREFIX.length)
  if (!id || id.includes('/')) return null
  return id
}

export function needsMediaUnderstanding(row: MediaContextRow): boolean {
  if (row.sender_type !== 'customer') return false
  if (row.ai_media_text && row.ai_media_text.trim()) return false
  if (!row.media_url) return false
  return row.content_type === 'audio' || row.content_type === 'image'
}

/**
 * Transcribe a voice note with OpenAI Whisper. Throws `AiError` on
 * provider failure so the caller can leave the message uncached.
 */
export async function transcribeAudio(args: {
  apiKey: string
  bytes: Buffer
  mime: string
  timeoutMs?: number
}): Promise<string> {
  const { apiKey, bytes, mime, timeoutMs = aiRequestTimeoutMs() } = args
  const ext = extensionForAudioMime(mime)
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: mime || 'audio/ogg' }),
    `voice.${ext}`,
  )
  form.append('model', 'whisper-1')

  let res: Response
  try {
    res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenAI Whisper', res)

  const data = (await res.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  if (!text) {
    throw new AiError('Whisper returned an empty transcript.', {
      code: 'empty_transcript',
    })
  }
  return text
}

/**
 * Short factual description of a customer photo.
 * OpenAI (or the embeddings key) first, then Anthropic, then DeepSeek
 * vision — DeepSeek's text models cannot see images.
 */
export async function describeImage(args: {
  config: MediaAiConfig
  bytes: Buffer
  mime: string
  timeoutMs?: number
}): Promise<string> {
  const { config, bytes, mime, timeoutMs = aiRequestTimeoutMs() } = args
  const openaiKey = openaiMediaKey(config)
  if (openaiKey) {
    return describeImageChatCompletions({
      apiKey: openaiKey,
      url: OPENAI_CHAT_URL,
      model: IMAGE_DESCRIBE_MODEL,
      maxTokensField: 'max_completion_tokens',
      label: 'OpenAI vision',
      bytes,
      mime,
      timeoutMs,
    })
  }
  if (config.provider === 'anthropic') {
    return describeImageAnthropic(config.apiKey, config.model, bytes, mime, timeoutMs)
  }
  if (config.provider === 'deepseek') {
    return describeImageChatCompletions({
      apiKey: config.apiKey,
      url: DEEPSEEK_CHAT_URL,
      model: DEEPSEEK_VISION_MODEL,
      maxTokensField: 'max_tokens',
      label: 'DeepSeek vision',
      bytes,
      mime,
      timeoutMs,
    })
  }
  throw new AiError('No vision provider available for this image.', {
    code: 'no_vision_provider',
    status: 400,
  })
}

async function describeImageChatCompletions(args: {
  apiKey: string
  url: string
  model: string
  maxTokensField: 'max_tokens' | 'max_completion_tokens'
  label: string
  bytes: Buffer
  mime: string
  timeoutMs: number
}): Promise<string> {
  const { apiKey, url, model, maxTokensField, label, bytes, mime, timeoutMs } = args
  const dataUrl = `data:${safeImageMime(mime)};base64,${bytes.toString('base64')}`
  const payload: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: IMAGE_DESCRIBE_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  }
  payload[maxTokensField] = 250

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError(label, res)
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[]
  } | null
  const text =
    typeof data?.choices?.[0]?.message?.content === 'string'
      ? data.choices[0].message.content.trim()
      : ''
  if (!text) {
    throw new AiError('Vision returned an empty description.', {
      code: 'empty_description',
    })
  }
  return text
}

async function describeImageAnthropic(
  apiKey: string,
  model: string,
  bytes: Buffer,
  mime: string,
  timeoutMs: number,
): Promise<string> {
  const mediaType = safeImageMime(mime)
  if (!ANTHROPIC_IMAGE_MIMES.has(mediaType)) {
    throw new AiError(`Anthropic cannot read ${mediaType} images.`, {
      code: 'unsupported_image_type',
      status: 400,
    })
  }
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 250,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: bytes.toString('base64'),
                },
              },
              { type: 'text', text: IMAGE_DESCRIBE_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Anthropic vision', res)
  const data = (await res.json().catch(() => null)) as {
    content?: { type?: string; text?: string }[]
  } | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Vision returned an empty description.', {
      code: 'empty_description',
    })
  }
  return text
}

const IMAGE_DESCRIBE_PROMPT =
  'Describe this WhatsApp image a customer sent to a sales agent. Be factual and specific. Include any readable text, numbers, prices, names, IDs, and what the photo shows. Write in the same language as text in the image, or Spanish if there is none. Do not guess beyond what is visible. Max 80 words.'

function safeImageMime(mime: string): string {
  const t = mime.trim().toLowerCase().split(';')[0]
  if (t === 'image/jpg') return 'image/jpeg'
  if (t.startsWith('image/')) return t
  return 'image/jpeg'
}

function extensionForAudioMime(mime: string): string {
  const t = mime.toLowerCase()
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3'
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a'
  if (t.includes('wav')) return 'wav'
  if (t.includes('amr')) return 'amr'
  return 'ogg'
}

async function loadMetaAccessToken(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !data?.access_token || typeof data.access_token !== 'string') {
      return null
    }
    return decrypt(data.access_token)
  } catch (err) {
    console.error('[ai media] decrypt WhatsApp token failed:', err)
    return null
  }
}

/**
 * Pull attachment bytes from the Meta proxy path or a public chat-media URL.
 */
export async function fetchMessageMediaBytes(
  db: SupabaseClient,
  accountId: string,
  mediaUrl: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const proxiedId = parseProxiedMediaId(mediaUrl)
  if (proxiedId) {
    const accessToken = await loadMetaAccessToken(db, accountId)
    if (!accessToken) return null
    try {
      const info = await getMediaUrl({ mediaId: proxiedId, accessToken })
      const { buffer, contentType } = await downloadMedia({
        downloadUrl: info.url,
        accessToken,
      })
      return { bytes: buffer, mime: contentType || info.mimeType }
    } catch (err) {
      console.error('[ai media] Meta download failed:', err)
      return null
    }
  }

  if (!/^https?:\/\//i.test(mediaUrl)) return null
  if (!(await isDeliverableUrl(mediaUrl))) return null

  try {
    const res = await fetch(mediaUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    })
    if (!res.ok) return null
    const mime = res.headers.get('content-type') || 'application/octet-stream'
    const bytes = Buffer.from(await res.arrayBuffer())
    return { bytes, mime }
  } catch (err) {
    console.error('[ai media] public download failed:', err)
    return null
  }
}

/**
 * Transcribe / describe the newest uncached customer audio and images,
 * persist `ai_media_text`, and mutate `rows` in place so the caller can
 * format without a second query. Best-effort: a failed file stays
 * uncached and the rest of the transcript still builds.
 */
export async function enrichCustomerMedia(
  db: SupabaseClient,
  accountId: string,
  rows: MediaContextRow[],
  config: MediaAiConfig,
): Promise<void> {
  const pending = rows.filter(needsMediaUnderstanding).slice(-MAX_MEDIA_ENRICH_PER_TURN)
  if (pending.length === 0) return

  await Promise.all(
    pending.map(async (row) => {
      try {
        const fetched = await fetchMessageMediaBytes(db, accountId, row.media_url!)
        if (!fetched) return
        const kind = row.content_type as MediaUnderstandKind
        const max = kind === 'audio' ? AUDIO_MAX_BYTES : IMAGE_MAX_BYTES
        if (fetched.bytes.length === 0 || fetched.bytes.length > max) return

        let text: string
        if (kind === 'audio') {
          const key = openaiMediaKey(config)
          if (!key) return
          text = await transcribeAudio({
            apiKey: key,
            bytes: fetched.bytes,
            mime: fetched.mime,
          })
        } else {
          text = await describeImage({
            config,
            bytes: fetched.bytes,
            mime: fetched.mime,
          })
        }
        if (!text.trim()) return
        row.ai_media_text = text
        const { error } = await db
          .from('messages')
          .update({ ai_media_text: text })
          .eq('id', row.id)
        if (error) {
          console.error('[ai media] cache write failed:', error)
        }
      } catch (err) {
        console.error(
          `[ai media] ${row.content_type} understand failed:`,
          err instanceof Error ? err.message : err,
        )
      }
    }),
  )
}
