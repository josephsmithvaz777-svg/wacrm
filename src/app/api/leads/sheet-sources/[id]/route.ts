import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parseSheetUrl } from '@/lib/leads/sheet-url';

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const limit = checkRateLimit(
      `admin:sheet-source:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.name === 'string') {
      patch.name = body.name.trim().slice(0, 120) || 'Formulario Google Sheets';
    }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.assign_round_robin === 'boolean') {
      patch.assign_round_robin = body.assign_round_robin;
    }
    if (typeof body.default_country_code === 'string') {
      patch.default_country_code =
        body.default_country_code.replace(/\D/g, '').slice(0, 4) || '51';
    }
    if (typeof body.tag_name === 'string') {
      patch.tag_name = body.tag_name.trim().slice(0, 80) || null;
    }
    if (typeof body.url === 'string') {
      const parsed = parseSheetUrl(body.url);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Pega la URL completa de la hoja de Google Sheets' },
          { status: 400 },
        );
      }
      patch.spreadsheet_url = parsed.canonicalUrl;
      patch.spreadsheet_id = parsed.spreadsheetId;
      patch.sheet_gid = parsed.sheetGid;
    }

    const { data, error } = await ctx.supabase
      .from('google_sheet_sources')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/leads/sheet-sources]', error);
      return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Fuente no encontrada' }, { status: 404 });
    }
    return NextResponse.json({ source: serialize(data as Record<string, unknown>) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const limit = checkRateLimit(
      `admin:sheet-source:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase
      .from('google_sheet_sources')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/leads/sheet-sources]', error);
      return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
