import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  beforeIsoForAge,
  deleteOldChatMedia,
  listOldChatMedia,
  parseAgeScope,
  parseMediaKind,
  summarizeCleanup,
  type CleanupAgeScope,
  type CleanupMediaKind,
} from '@/lib/storage/cleanup-chat-media'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

function readScope(request: Request, body: unknown): {
  age: CleanupAgeScope | null
  kind: CleanupMediaKind
} {
  const url = new URL(request.url)
  const fromBody =
    body && typeof body === 'object'
      ? (body as { olderThanDays?: unknown; age?: unknown; kind?: unknown })
      : null
  const age = parseAgeScope(
    fromBody?.age ?? fromBody?.olderThanDays ?? url.searchParams.get('age') ?? url.searchParams.get('olderThanDays'),
  )
  const kind =
    parseMediaKind(fromBody?.kind ?? url.searchParams.get('kind')) ?? 'all'
  return { age, kind }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const { age, kind } = readScope(request, null)
    if (!age) {
      return NextResponse.json(
        {
          error:
            'age must be 7, 14, 30, 60, 90 or before_month',
        },
        { status: 400 },
      )
    }
    const before = beforeIsoForAge(age)
    const rows = await listOldChatMedia(
      supabaseAdmin(),
      ctx.accountId,
      before,
      kind,
    )
    return NextResponse.json({
      preview: summarizeCleanup(rows, age, kind, before),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`admin:media-cleanup:${ctx.userId}`, {
      limit: 5,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const { age, kind } = readScope(request, body)
    if (!age) {
      return NextResponse.json(
        {
          error:
            'age must be 7, 14, 30, 60, 90 or before_month',
        },
        { status: 400 },
      )
    }

    const before = beforeIsoForAge(age)
    const admin = supabaseAdmin()
    const rows = await listOldChatMedia(admin, ctx.accountId, before, kind)
    const preview = summarizeCleanup(rows, age, kind, before)
    const result = await deleteOldChatMedia(admin, ctx.accountId, rows)
    return NextResponse.json({ preview, result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
