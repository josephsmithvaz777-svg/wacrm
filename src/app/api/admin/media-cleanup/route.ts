import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  beforeIsoForDays,
  deleteOldChatMedia,
  listOldChatMedia,
  parseOlderThanDays,
  summarizeCleanup,
} from '@/lib/storage/cleanup-chat-media'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

function daysFrom(request: Request, body: unknown): number | null {
  if (body && typeof body === 'object' && 'olderThanDays' in body) {
    return parseOlderThanDays((body as { olderThanDays?: unknown }).olderThanDays)
  }
  const url = new URL(request.url)
  return parseOlderThanDays(url.searchParams.get('olderThanDays'))
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const days = daysFrom(request, null)
    if (!days) {
      return NextResponse.json(
        { error: 'olderThanDays must be 30, 60 or 90' },
        { status: 400 },
      )
    }
    const before = beforeIsoForDays(days)
    const rows = await listOldChatMedia(supabaseAdmin(), ctx.accountId, before)
    return NextResponse.json({ preview: summarizeCleanup(rows, days, before) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(
      `admin:media-cleanup:${ctx.userId}`,
      { limit: 5, windowMs: 60_000 },
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const days = parseOlderThanDays(
      body && typeof body === 'object'
        ? (body as { olderThanDays?: unknown }).olderThanDays
        : null,
    )
    if (!days) {
      return NextResponse.json(
        { error: 'olderThanDays must be 30, 60 or 90' },
        { status: 400 },
      )
    }

    const before = beforeIsoForDays(days)
    const admin = supabaseAdmin()
    const rows = await listOldChatMedia(admin, ctx.accountId, before)
    const preview = summarizeCleanup(rows, days, before)
    const result = await deleteOldChatMedia(admin, ctx.accountId, rows)
    return NextResponse.json({ preview, result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
