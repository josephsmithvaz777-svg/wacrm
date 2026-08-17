import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  processWahaEvent,
  type WahaWebhookEvent,
} from '@/lib/whatsapp/waha-inbound';

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

/**
 * POST /api/whatsapp/waha/webhook
 *
 * Public endpoint for WAHA session webhooks. Matches config by session name.
 */
export async function POST(request: Request) {
  let body: WahaWebhookEvent;
  try {
    body = (await request.json()) as WahaWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body?.event || !body?.session) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  let { data: configs, error } = await admin()
    .from('whatsapp_config')
    .select(
      'id, account_id, user_id, provider, waha_base_url, waha_session, access_token',
    )
    .eq('provider', 'waha')
    .eq('waha_session', body.session);

  if (error) {
    console.error('[waha/webhook] config lookup failed:', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  if (!configs?.length) {
    const fallback = await admin()
      .from('whatsapp_config')
      .select(
        'id, account_id, user_id, provider, waha_base_url, waha_session, access_token',
      )
      .eq('provider', 'waha')
      .ilike('waha_session', body.session);
    configs = fallback.data ?? [];
  }

  if (!configs?.length) {
    console.warn('[waha/webhook] no config for session', body.session, body.event);
    return NextResponse.json({ ok: true, matched: false });
  }

  const payload = body.payload || {};
  const fromMeHint =
    body.event === 'message.any' ||
    body.event === 'engine.event' ||
    (typeof payload === 'object' &&
      payload !== null &&
      (payload as { fromMe?: unknown }).fromMe === true);

  const run = async () => {
    for (const row of configs) {
      if (!row.waha_base_url) continue;
      let apiKey: string | null = null;
      if (row.access_token) {
        try {
          apiKey = decrypt(row.access_token);
        } catch (err) {
          console.error('[waha/webhook] decrypt failed:', err);
          continue;
        }
      }
      try {
        await processWahaEvent(body, {
          account_id: row.account_id,
          user_id: row.user_id,
          waha_base_url: row.waha_base_url,
          waha_session: row.waha_session || 'default',
          access_token: apiKey,
        });
      } catch (err) {
        console.error('[waha/webhook] process failed:', err);
      }
    }
  };

  // Phone-sent echoes only arrive as message.any. Process them before
  // the response so a host that drops `after()` work cannot lose them.
  // Inbound `message` events still run in `after()` so media download
  // is not billed against the request timeout.
  if (fromMeHint) {
    await run();
  } else {
    after(run);
  }

  return NextResponse.json({ ok: true });
}
