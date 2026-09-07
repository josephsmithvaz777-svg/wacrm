import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizeWhatsAppJid } from '@/lib/whatsapp/contact-identity';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  ensureWebhookSubscription,
  fetchWahaContactIdentity,
  isUsableDisplayName,
  type WahaClientOptions,
} from '@/lib/whatsapp/waha-api';
import {
  syncWahaConversation,
  type SyncWahaConversationResult,
} from '@/lib/whatsapp/waha-sync';

export const maxDuration = 60;

type ContactRow = {
  id?: string;
  name?: string | null;
  phone?: string | null;
  whatsapp_jid?: string | null;
  whatsapp_username?: string | null;
};

async function persistWahaUsername(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    contact: ContactRow & { id: string };
    phone: string;
    opts: WahaClientOptions;
    chatId: string | null;
    historyUsername: string | null;
  },
): Promise<string | null> {
  const { contact, phone, opts } = params;
  let username = contact.whatsapp_username || params.historyUsername;
  let displayName: string | null = null;
  const lookupId = params.chatId || contact.whatsapp_jid || phone;

  if (!username || !contact.whatsapp_jid) {
    try {
      const identity = await fetchWahaContactIdentity(opts, lookupId, phone);
      username = username || identity.username;
      displayName = identity.name;
    } catch (err) {
      console.warn('[waha/sync-chat] contact identity lookup failed:', err);
    }
  }

  const patch: Record<string, unknown> = {};
  if (username && !contact.whatsapp_username) {
    patch.whatsapp_username = username;
  }
  const jid = normalizeWhatsAppJid(params.chatId);
  if (jid && !contact.whatsapp_jid) patch.whatsapp_jid = jid;
  if (
    displayName &&
    isUsableDisplayName(displayName, phone) &&
    (!contact.name || !isUsableDisplayName(contact.name, phone))
  ) {
    patch.name = displayName;
  } else if (
    username &&
    (!contact.name || !isUsableDisplayName(contact.name, phone))
  ) {
    patch.name = `@${username}`;
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    await supabase.from('contacts').update(patch).eq('id', contact.id);
  }

  return username || contact.whatsapp_username || null;
}

/**
 * Per-session throttle for the webhook-subscription repair. The repair
 * restarts the WAHA session, so it must not run on every thread open —
 * once per process per interval is enough to self-heal a session that
 * was created before `message.any` joined the event list.
 */
const lastSubscriptionCheck = new Map<string, number>();
const SUBSCRIPTION_CHECK_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/whatsapp/waha/sync-chat
 *
 * Backfills a conversation from WAHA's own chat history so messages the
 * webhook never delivered (phone-sent echoes, `@lid` chats, dropped
 * deliveries) still land in the thread.
 */
export async function POST(request: Request) {
  try {
    return await handleSync(request);
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handleSync(request: Request) {
  const ctx = await getCurrentAccount();

  let conversationId = '';
  try {
    const body = (await request.json()) as { conversation_id?: unknown };
    if (typeof body?.conversation_id === 'string') {
      conversationId = body.conversation_id;
    }
  } catch {
    // handled below
  }
  if (!conversationId) {
    return NextResponse.json(
      { error: 'conversation_id is required' },
      { status: 400 },
    );
  }

  const { data: config } = await ctx.supabase
    .from('whatsapp_config')
    .select('provider, waha_base_url, waha_session, access_token')
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  // Meta delivers reliably and has no history endpoint — tell the client
  // so it stops polling instead of retrying forever.
  if (!config || config.provider !== 'waha' || !config.waha_base_url) {
    return NextResponse.json({ supported: false, inserted: 0 });
  }

  const { data: conversation } = await ctx.supabase
    .from('conversations')
    .select(
      'id, contact:contacts(id, name, phone, whatsapp_jid, whatsapp_username)',
    )
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  // The embedded relation comes back as an object or a single-element
  // array depending on how the FK is introspected — accept both.
  const contactRel = conversation?.contact as
    | ContactRow
    | ContactRow[]
    | null
    | undefined;
  const contact = Array.isArray(contactRel) ? contactRel[0] : contactRel;
  const phone = contact?.phone;
  if (!conversation || !phone || !contact?.id) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  const contactId = contact.id;

  let apiKey: string | null = null;
  if (config.access_token) {
    try {
      apiKey = decrypt(config.access_token as string);
    } catch {
      return NextResponse.json(
        { error: 'Stored WAHA API key cannot be decrypted. Re-save it in Settings.' },
        { status: 400 },
      );
    }
  }

  const opts: WahaClientOptions = {
    baseUrl: config.waha_base_url as string,
    session: (config.waha_session as string) || 'default',
    apiKey,
  };

  // The browser's own origin is the most reliable answer for "where does
  // this CRM live" — a stale NEXT_PUBLIC_SITE_URL would otherwise
  // register a webhook the deployment never receives.
  const origin = (
    request.headers.get('origin') ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    new URL(request.url).origin
  ).replace(/\/+$/, '');
  const webhookUrl = `${origin}/api/whatsapp/waha/webhook`;

  let synced: SyncWahaConversationResult;
  try {
    synced = await syncWahaConversation({
      accountId: ctx.accountId,
      conversationId,
      phone,
      chatJid: contact.whatsapp_jid,
      opts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WAHA sync failed';
    console.error('[waha/sync-chat] sync failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const usernameFilled = await persistWahaUsername(ctx.supabase, {
    contact: { ...contact, id: contactId },
    phone,
    opts,
    chatId: synced.chatId,
    historyUsername: synced.username,
  });

  // Repaired after the history read on purpose: the update restarts the
  // WAHA session, which would make the read above come back empty.
  const webhookRepaired = await repairWebhookSubscription(opts, webhookUrl);

  return NextResponse.json({
    supported: true,
    inserted: synced.inserted,
    scanned: synced.scanned,
    chat_id: synced.chatId,
    username: usernameFilled,
    webhook_url: webhookUrl,
    webhook_repaired: webhookRepaired,
  });
}

async function repairWebhookSubscription(
  opts: WahaClientOptions,
  webhookUrl: string,
): Promise<boolean> {
  const key = `${opts.baseUrl}|${opts.session}`;
  const checkedAt = lastSubscriptionCheck.get(key) ?? 0;
  if (Date.now() - checkedAt <= SUBSCRIPTION_CHECK_TTL_MS) return false;
  lastSubscriptionCheck.set(key, Date.now());
  try {
    const result = await ensureWebhookSubscription(opts, webhookUrl);
    if (result.repaired) {
      console.log('[waha/sync-chat] webhook subscription repaired', result.events);
    }
    return result.repaired;
  } catch (err) {
    console.warn('[waha/sync-chat] webhook subscription check failed:', err);
    return false;
  }
}
