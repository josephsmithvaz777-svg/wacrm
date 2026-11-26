import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { backfillMetaLeads } from '@/lib/meta/lead-links';
import { flushMetaCrmEvents } from '@/lib/meta/flush-crm-events';

export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:meta-backfill:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const result = await backfillMetaLeads(admin, ctx.accountId);
    const flushed = await flushMetaCrmEvents(admin);
    return NextResponse.json({ ...result, sent: flushed.sent });
  } catch (err) {
    return toErrorResponse(err);
  }
}
