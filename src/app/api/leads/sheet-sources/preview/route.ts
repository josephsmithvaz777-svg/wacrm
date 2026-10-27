import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { previewSheetSource } from '@/lib/leads/import-sheet-leads';
import { SheetFetchError } from '@/lib/leads/fetch-sheet';
import { parseSheetUrl } from '@/lib/leads/sheet-url';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:sheet-preview:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const parsed = parseSheetUrl(typeof body?.url === 'string' ? body.url : '');
    if (!parsed) {
      return NextResponse.json(
        { error: 'Pega la URL completa de la hoja de Google Sheets' },
        { status: 400 },
      );
    }

    try {
      const preview = await previewSheetSource(parsed.spreadsheetId, parsed.sheetGid);
      return NextResponse.json({
        ok: true,
        spreadsheetId: parsed.spreadsheetId,
        sheetGid: parsed.sheetGid,
        ...preview,
      });
    } catch (err) {
      const message =
        err instanceof SheetFetchError
          ? err.message
          : 'No se pudo leer la hoja';
      return NextResponse.json({ error: message }, { status: 422 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
