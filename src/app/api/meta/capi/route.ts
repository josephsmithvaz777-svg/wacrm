import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { parseCapiConfigInput } from '@/lib/meta/crm-events';

function publicConfig(row: {
  enabled?: boolean;
  dataset_id?: string;
  lead_event_source?: string;
  test_event_code?: string | null;
  access_token?: string;
  last_error?: string | null;
  last_sent_at?: string | null;
} | null) {
  return {
    enabled: row?.enabled === true,
    dataset_id: row?.dataset_id ?? '',
    lead_event_source: row?.lead_event_source || 'wacrm',
    test_event_code: row?.test_event_code ?? '',
    has_token: Boolean(row?.access_token),
    last_error: row?.last_error ?? null,
    last_sent_at: row?.last_sent_at ?? null,
  };
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const admin = supabaseAdmin();
    const [configRes, pipelineRes, eventRes] = await Promise.all([
      admin
        .from('meta_capi_config')
        .select(
          'enabled, dataset_id, lead_event_source, test_event_code, access_token, last_error, last_sent_at',
        )
        .eq('account_id', ctx.accountId)
        .maybeSingle(),
      admin.from('pipelines').select('id, name').eq('account_id', ctx.accountId),
      admin
        .from('meta_crm_events')
        .select('id, event_name, status, event_time, last_error, meta_lead_id')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const pipelines = (pipelineRes.data ?? []) as { id: string; name: string }[];
    const pipelineIds = pipelines.map((pipeline) => pipeline.id);
    const names = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));
    let stages: {
      id: string;
      name: string;
      pipeline_name: string;
      position: number;
      meta_funnel_role: string;
    }[] = [];
    if (pipelineIds.length > 0) {
      const { data } = await admin
        .from('pipeline_stages')
        .select('id, name, position, meta_funnel_role, pipeline_id')
        .in('pipeline_id', pipelineIds)
        .order('position', { ascending: true });
      stages = ((data ?? []) as {
        id: string;
        name: string;
        position: number;
        meta_funnel_role: string;
        pipeline_id: string;
      }[])
        .map((stage) => ({
          id: stage.id,
          name: stage.name,
          pipeline_name: names.get(stage.pipeline_id) ?? '',
          position: stage.position,
          meta_funnel_role: stage.meta_funnel_role ?? 'unspecified',
        }))
        .sort((a, b) => a.pipeline_name.localeCompare(b.pipeline_name) || a.position - b.position);
    }

    return NextResponse.json({
      config: publicConfig(configRes.data),
      stages,
      events: eventRes.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:meta-capi:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseCapiConfigInput(await request.json().catch(() => null));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: existing } = await admin
      .from('meta_capi_config')
      .select('access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    const accessToken = parsed.value.accessToken || (existing?.access_token as string | undefined) || '';
    if (parsed.value.enabled && !accessToken) {
      return NextResponse.json(
        { error: 'Pega el token de acceso de Meta antes de activar el envío' },
        { status: 400 },
      );
    }

    const { error } = await admin.from('meta_capi_config').upsert(
      {
        account_id: ctx.accountId,
        enabled: parsed.value.enabled,
        dataset_id: parsed.value.datasetId,
        access_token: accessToken,
        lead_event_source: parsed.value.leadEventSource,
        test_event_code: parsed.value.testEventCode || null,
        last_error: null,
      },
      { onConflict: 'account_id' },
    );
    if (error) {
      console.error('[PUT /api/meta/capi]', error);
      return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
    }

    const { data: saved } = await admin
      .from('meta_capi_config')
      .select(
        'enabled, dataset_id, lead_event_source, test_event_code, access_token, last_error, last_sent_at',
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    return NextResponse.json({ config: publicConfig(saved) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
