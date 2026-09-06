import type { SupabaseClient } from '@supabase/supabase-js'

export const AI_MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const
export type AiMediaKind = (typeof AI_MEDIA_KINDS)[number]

/** Keep the catalog small — every asset is listed in the system prompt. */
export const MAX_AI_MEDIA_ASSETS = 20

export interface AiMediaAsset {
  id: string
  title: string
  description: string | null
  kind: AiMediaKind
  media_url: string
  storage_path: string
  filename: string | null
}

export function isAiMediaKind(value: unknown): value is AiMediaKind {
  return typeof value === 'string' && (AI_MEDIA_KINDS as readonly string[]).includes(value)
}

/**
 * Map an uploaded MIME type onto a WhatsApp send kind. Returns null
 * when the type isn't in the chat-media allow-list (migration 023).
 */
export function kindFromMime(mime: string): AiMediaKind | null {
  const t = mime.trim().toLowerCase()
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/webp') return 'image'
  if (t === 'video/mp4' || t === 'video/3gpp') return 'video'
  if (
    t === 'audio/ogg' ||
    t === 'audio/mpeg' ||
    t === 'audio/aac' ||
    t === 'audio/mp4' ||
    t === 'audio/amr'
  ) {
    return 'audio'
  }
  if (
    t === 'application/pdf' ||
    t === 'application/msword' ||
    t === 'application/vnd.ms-excel' ||
    t === 'application/vnd.ms-powerpoint' ||
    t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    t === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    t === 'text/plain'
  ) {
    return 'document'
  }
  return null
}

/**
 * Account catalog for the system prompt + send resolution. Best-effort:
 * a missing table / RLS miss returns [] so draft/auto-reply still work.
 */
export async function listAiMediaAssets(
  db: SupabaseClient,
  accountId: string,
): Promise<AiMediaAsset[]> {
  try {
    const { data, error } = await db
      .from('ai_media_assets')
      .select('id, title, description, kind, media_url, storage_path, filename')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(MAX_AI_MEDIA_ASSETS)
    if (error || !Array.isArray(data)) return []
    return data.filter(
      (row): row is AiMediaAsset =>
        typeof row?.id === 'string' &&
        typeof row.title === 'string' &&
        isAiMediaKind(row.kind) &&
        typeof row.media_url === 'string',
    )
  } catch {
    return []
  }
}
