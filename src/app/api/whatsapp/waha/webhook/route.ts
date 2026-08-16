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

  const { data: configs, error } = await admin()
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
    // Unknown session — ack so WAHA does not retry forever.
    console.warn('[waha/webhook] no config for session', body.session);
    return NextResponse.json({ ok: true, matched: false });
  }

  // Respond quickly; process after.
  after(async () => {
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
  });

  return NextResponse.json({ ok: true });
}
