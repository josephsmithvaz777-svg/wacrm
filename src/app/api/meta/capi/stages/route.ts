import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parseFunnelRole } from '@/lib/meta/crm-events';

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:meta-stage:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      stage_id?: unknown;
      role?: unknown;
    } | null;
    const stageId = typeof body?.stage_id === 'string' ? body.stage_id : '';
    const role = parseFunnelRole(body?.role);
    if (!stageId || !role) {
      return NextResponse.json({ error: 'Etapa o rol inválido' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: stage } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id')
      .eq('id', stageId)
      .maybeSingle();
    if (!stage?.pipeline_id) {
      return NextResponse.json({ error: 'Etapa no encontrada' }, { status: 404 });
    }
    const { data: pipeline } = await admin
      .from('pipelines')
      .select('id')
      .eq('id', stage.pipeline_id as string)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!pipeline) {
      return NextResponse.json({ error: 'Etapa no encontrada' }, { status: 404 });
    }

    const { error } = await admin
      .from('pipeline_stages')
      .update({ meta_funnel_role: role })
      .eq('id', stageId);
    if (error) {
      console.error('[PATCH /api/meta/capi/stages]', error);
      return NextResponse.json({ error: 'No se pudo guardar la etapa' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
