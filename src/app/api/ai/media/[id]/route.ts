import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/ai/media/[id]  (admin+) — title / when-to-send copy only.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-media:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const description =
      typeof body?.description === 'string' ? body.description.trim() || null : undefined
    if (title === undefined && description === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (title !== undefined && !title) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    }

    const update: Record<string, string | null> = {}
    if (title !== undefined) update.title = title
    if (description !== undefined) update.description = description

    const { data, error } = await supabase
      .from('ai_media_assets')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/media/[id] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/media/[id]  (admin+) — drop the row and best-effort
 * garbage-collect the chat-media object.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params
    const { data: row, error: loadErr } = await supabase
      .from('ai_media_assets')
      .select('id, storage_path')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (loadErr) {
      console.error('[ai/media/[id] DELETE] load error:', loadErr)
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
    }
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabase
      .from('ai_media_assets')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/media/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
    }

    if (row.storage_path) {
      const { error: storageErr } = await supabase.storage
        .from('chat-media')
        .remove([row.storage_path])
      if (storageErr) {
        console.warn('[ai/media/[id] DELETE] storage cleanup:', storageErr.message)
      }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
