import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { buildAudienceCsv } from '@/lib/meta/crm-events';
import { listAudienceContacts } from '@/lib/meta/audience';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:meta-audience:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const role = new URL(request.url).searchParams.get('role');
    if (role !== 'positive' && role !== 'negative') {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
    }

    const contacts = await listAudienceContacts(supabaseAdmin(), ctx.accountId, role);
    const { csv, rows } = buildAudienceCsv(contacts);
    if (rows === 0) {
      return NextResponse.json({ rows: 0 });
    }
    const filename = role === 'positive' ? 'leads-calidad.csv' : 'leads-no-calificados.csv';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Row-Count': String(rows),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
