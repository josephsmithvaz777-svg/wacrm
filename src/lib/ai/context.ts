import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage, AiConfig } from './types'
import type { MessageAdContext } from '@/lib/whatsapp/ad-context'
import { aiContextMessageLimit } from './defaults'
import {
  enrichCustomerMedia,
  type MediaContextRow,
} from './understand-media'

interface DbMessage extends MediaContextRow {
  ad_context: MessageAdContext | null
}

const PLACEHOLDER_CAPTION = /^\[(image|audio|video|document)\]$/i

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * Includes images, voice notes, videos, documents, locations, and
 * Click-to-WhatsApp ad cards — not only text. Customer audio is
 * transcribed and photos described when `opts.config` is passed
 * (Whisper / vision), then cached on the row.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  opts?: {
    limit?: number
    accountId?: string
    config?: Pick<AiConfig, 'provider' | 'apiKey' | 'model' | 'embeddingsApiKey'>
  },
): Promise<ChatMessage[]> {
  const limit = opts?.limit ?? aiContextMessageLimit()
  const { data, error } = await db
    .from('messages')
    .select(
      'id, sender_type, content_type, content_text, media_url, ad_context, ai_media_text',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()

  if (opts?.accountId && opts.config) {
    await enrichCustomerMedia(db, opts.accountId, rows, opts.config)
  }

  return rows
    .map((m) => {
      const content = formatMessageForModel(m)
      if (!content) return null
      return {
        role: (m.sender_type === 'customer' ? 'user' : 'assistant') as ChatMessage['role'],
        content,
      }
    })
    .filter((m): m is ChatMessage => m !== null)
}

/** Caption WhatsApp sometimes stores as `[image]` / `[audio]` when there is none. */
export function usefulCaption(text: string | null | undefined): string {
  const t = text?.trim() ?? ''
  if (!t || PLACEHOLDER_CAPTION.test(t)) return ''
  return t
}

export function formatAdContext(ad: MessageAdContext | null | undefined): string | null {
  if (!ad) return null
  const source =
    ad.source === 'instagram_ad'
      ? 'Instagram ad'
      : ad.source === 'facebook_ad'
        ? 'Facebook ad'
        : 'ad'
  const bits = [ad.headline, ad.body].map((s) => s?.trim()).filter(Boolean)
  if (bits.length === 0) return `[The customer tapped a ${source}]`
  return `[The customer tapped a ${source}: ${bits.join(' — ')}]`
}

/**
 * Turn one stored WhatsApp message into the text the model sees.
 * Audio/image understanding lives in `ai_media_text` when available.
 */
export function formatMessageForModel(row: {
  sender_type: 'customer' | 'agent' | 'bot' | string
  content_type?: string | null
  content_text?: string | null
  ai_media_text?: string | null
  ad_context?: MessageAdContext | null
}): string | null {
  const fromCustomer = row.sender_type === 'customer'
  const kind = row.content_type || 'text'
  const caption = usefulCaption(row.content_text)
  const understood = row.ai_media_text?.trim() || ''
  const chunks: string[] = []

  const ad = formatAdContext(row.ad_context)
  if (ad) chunks.push(ad)

  switch (kind) {
    case 'audio':
      if (understood) chunks.push(`[Voice note] ${understood}`)
      else if (fromCustomer) {
        chunks.push(
          '[The customer sent a voice note. The audio was not transcribed.]',
        )
      } else {
        chunks.push('[Sent a voice note]')
      }
      break
    case 'image':
      if (understood) {
        chunks.push(`[Image] ${understood}`)
        if (caption) chunks.push(`Caption: ${caption}`)
      } else if (fromCustomer) {
        chunks.push(
          caption
            ? `[The customer sent an image with caption: ${caption}]`
            : '[The customer sent an image. The pixels were not described.]',
        )
      } else {
        chunks.push(caption ? `[Sent an image] ${caption}` : '[Sent an image]')
      }
      break
    case 'video':
      chunks.push(
        fromCustomer
          ? caption
            ? `[The customer sent a video with caption: ${caption}]`
            : '[The customer sent a video]'
          : caption
            ? `[Sent a video] ${caption}`
            : '[Sent a video]',
      )
      break
    case 'document':
      chunks.push(
        fromCustomer
          ? caption
            ? `[The customer sent a document: ${caption}]`
            : '[The customer sent a document]'
          : caption
            ? `[Sent a document] ${caption}`
            : '[Sent a document]',
      )
      break
    default:
      if (caption) chunks.push(caption)
      break
  }

  const text = chunks.join('\n').trim()
  return text || null
}
