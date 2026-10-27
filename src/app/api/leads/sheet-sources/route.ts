import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parseSheetUrl } from '@/lib/leads/sheet-url';
import { ensureSheetLeadSyncLoop } from '@/lib/leads/import-sheet-leads';

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    spreadsheet_url: row.spreadsheet_url,
    spreadsheet_id: row.spreadsheet_id,
    sheet_gid: row.sheet_gid,
    enabled: row.enabled,
    assign_round_robin: row.assign_round_robin,
    default_country_code: row.default_country_code,
    tag_name: row.tag_name,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    last_imported_count: row.last_imported_count,
    created_at: row.created_at,
  };
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    ensureSheetLeadSyncLoop();
    const { data, error } = await ctx.supabase
      .from('google_sheet_sources')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/leads/sheet-sources]', error);
      return NextResponse.json({ error: 'No se pudieron cargar las hojas' }, { status: 500 });
    }
    return NextResponse.json({
      sources: ((data ?? []) as Record<string, unknown>[]).map(serialize),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:sheet-source:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      url?: unknown;
      name?: unknown;
      assign_round_robin?: unknown;
      default_country_code?: unknown;
      tag_name?: unknown;
    } | null;

    const parsed = parseSheetUrl(typeof body?.url === 'string' ? body.url : '');
    if (!parsed) {
      return NextResponse.json(
        { error: 'Pega la URL completa de la hoja de Google Sheets' },
        { status: 400 },
      );
    }

    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : 'Formulario Google Sheets';
    const country =
      typeof body?.default_country_code === 'string'
        ? body.default_country_code.replace(/\D/g, '').slice(0, 4) || '51'
        : '51';
    const tagName =
      typeof body?.tag_name === 'string' && body.tag_name.trim()
        ? body.tag_name.trim().slice(0, 80)
        : null;

    const { data, error } = await ctx.supabase
      .from('google_sheet_sources')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name,
        spreadsheet_url: parsed.canonicalUrl,
        spreadsheet_id: parsed.spreadsheetId,
        sheet_gid: parsed.sheetGid,
        assign_round_robin: body?.assign_round_robin !== false,
        default_country_code: country,
        tag_name: tagName,
        enabled: true,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Esa hoja ya está conectada' },
          { status: 409 },
        );
      }
      console.error('[POST /api/leads/sheet-sources]', error);
      return NextResponse.json({ error: 'No se pudo guardar la hoja' }, { status: 500 });
    }

    return NextResponse.json({ source: serialize(data as Record<string, unknown>) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
