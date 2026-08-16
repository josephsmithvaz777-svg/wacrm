import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  ensureSession,
  getQrDataUrl,
  getSession,
  type WahaClientOptions,
} from '@/lib/whatsapp/waha-api';

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

async function loadWahaOpts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<
  | { ok: true; opts: WahaClientOptions; rowId: string }
  | { ok: false; status: number; error: string }
> {
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('id, provider, waha_base_url, waha_session, access_token')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !config) {
    return { ok: false, status: 400, error: 'No WhatsApp configuration saved.' };
  }
  if (config.provider !== 'waha') {
    return {
      ok: false,
      status: 400,
      error: 'This account is configured for Meta, not WAHA.',
    };
  }
  if (!config.waha_base_url) {
    return { ok: false, status: 400, error: 'WAHA base URL is missing.' };
  }

  let apiKey: string | null = null;
  if (config.access_token) {
    try {
      apiKey = decrypt(config.access_token);
    } catch {
      return {
        ok: false,
        status: 400,
        error: 'Stored WAHA API key cannot be decrypted. Reset and re-save.',
      };
    }
  }

  return {
    ok: true,
    rowId: config.id as string,
    opts: {
      baseUrl: config.waha_base_url as string,
      session: (config.waha_session as string) || 'default',
      apiKey,
    },
  };
}

/**
 * GET /api/whatsapp/waha/session — session status
 * POST /api/whatsapp/waha/session — ensure session + return QR when needed
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountId = await resolveAccountId(supabase, user.id);
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 });
  }

  const loaded = await loadWahaOpts(supabase, accountId);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  try {
    const session = await getSession(loaded.opts);
    return NextResponse.json({
      session: session?.name || loaded.opts.session,
      status: session?.status || 'STOPPED',
      me: session?.me ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WAHA error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accountId = await resolveAccountId(supabase, user.id);
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 403 });
  }

  const loaded = await loadWahaOpts(supabase, accountId);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  let origin = process.env.NEXT_PUBLIC_SITE_URL || '';
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body.origin === 'string' && body.origin) {
      origin = body.origin.replace(/\/+$/, '');
    }
  } catch {
    // ignore
  }
  if (!origin) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_SITE_URL is required to register the WAHA webhook.' },
      { status: 400 },
    );
  }

  const webhookUrl = `${origin.replace(/\/+$/, '')}/api/whatsapp/waha/webhook`;

  try {
    const ensured = await ensureSession(loaded.opts, webhookUrl);
    let qr: string | null = null;
    if (
      ensured.status === 'SCAN_QR_CODE' ||
      ensured.status === 'STARTING' ||
      ensured.status === 'STOPPED'
    ) {
      try {
        qr = await getQrDataUrl(loaded.opts);
      } catch (err) {
        console.warn('[waha/session] QR not ready yet:', err);
      }
    }

    if (ensured.status === 'WORKING') {
      await supabase
        .from('whatsapp_config')
        .update({
          status: 'connected',
          connected_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          last_registration_error: null,
        })
        .eq('id', loaded.rowId);
    }

    return NextResponse.json({
      session: ensured.name,
      status: ensured.status,
      webhook_url: webhookUrl,
      qr,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WAHA error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
