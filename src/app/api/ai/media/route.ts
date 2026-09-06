import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  isAiMediaKind,
  kindFromMime,
  MAX_AI_MEDIA_ASSETS,
} from '@/lib/ai/media-assets'

/**
 * GET /api/ai/media — list catalog files (any member).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_media_assets')
      .select('id, title, description, kind, media_url, filename, mime_type, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[ai/media GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load media files' },
        { status: 500 },
      )
    }
    return NextResponse.json({ assets: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/media  (admin+)
 *
 * Register a file already uploaded to `chat-media`. The client uploads
 * via `uploadAccountMedia` first, then sends the public URL + path.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-media:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { count } = await supabase
      .from('ai_media_assets')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_AI_MEDIA_ASSETS) {
      return NextResponse.json(
        { error: `You can store up to ${MAX_AI_MEDIA_ASSETS} files for the agent.` },
        { status: 400 },
      )
    }

    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const description =
      typeof body?.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null
    const mediaUrl = typeof body?.media_url === 'string' ? body.media_url.trim() : ''
    const storagePath =
      typeof body?.storage_path === 'string' ? body.storage_path.trim() : ''
    const filename =
      typeof body?.filename === 'string' && body.filename.trim()
        ? body.filename.trim()
        : null
    const mimeType =
      typeof body?.mime_type === 'string' ? body.mime_type.trim() : ''
    if (!title || !mediaUrl || !storagePath) {
      return NextResponse.json(
        { error: 'title, media_url, and storage_path are required' },
        { status: 400 },
      )
    }
    if (!storagePath.startsWith(`account-${accountId}/`)) {
      return NextResponse.json(
        { error: 'storage_path must belong to this account' },
        { status: 400 },
      )
    }

    const kind = isAiMediaKind(body?.kind) ? body.kind : kindFromMime(mimeType)
    if (!kind) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use a WhatsApp image, video, audio, or PDF.' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ai_media_assets')
      .insert({
        account_id: accountId,
        created_by: userId,
        title,
        description,
        kind,
        media_url: mediaUrl,
        storage_path: storagePath,
        filename,
        mime_type: mimeType || null,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[ai/media POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save media file' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
