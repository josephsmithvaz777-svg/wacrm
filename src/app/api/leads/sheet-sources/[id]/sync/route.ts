import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  ensureSheetLeadSyncLoop,
  syncSheetSourceById,
} from '@/lib/leads/import-sheet-leads';
import {
  checkRateLimit,
  rateLimitResponse,
} from '@/lib/rate-limit';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const limit = checkRateLimit(
      `admin:sheet-sync:${ctx.userId}`,
      { limit: 10, windowMs: 60_000 },
    );
    if (!limit.success) return rateLimitResponse(limit);

    ensureSheetLeadSyncLoop();
    const result = await syncSheetSourceById(supabaseAdmin(), id, ctx.accountId);
    if (result.error && result.imported === 0 && result.skipped === 0) {
      return NextResponse.json({ error: result.error, result }, { status: 422 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
