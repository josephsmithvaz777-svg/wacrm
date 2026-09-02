// ============================================================
// Pull-based WAHA history sync.
//
// The webhook is best-effort: a session subscribed to an older event
// list, a cold start that drops `after()` work, or a chat the CRM
// cannot map to a phone (`@lid`) all end with a message that exists on
// WhatsApp but never in the CRM. Asking WAHA for the chat's recent
// messages closes that gap — the engine's own history is authoritative
// and includes messages sent from the phone (`fromMe`).
//
// Idempotent: rows are matched on the WhatsApp message id (normalised,
// because engines serialise it as `{true|false}_{jid}_{ID}`), so a sync
// never duplicates a message the webhook or the CRM send already saved.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import {
  extractInboundText,
  extractWahaMessageId,
  fetchWahaChatMessages,
  isWahaFromMe,
  parseWahaSerializedId,
  resolveOutboundChatId,
  type WahaClientOptions,
} from '@/lib/whatsapp/waha-api';
import { extractAdContext } from '@/lib/whatsapp/ad-context';
import {
  mimeToContentType,
  persistAdCreativeSafe,
  readMediaRef,
  uploadWahaMedia,
} from '@/lib/whatsapp/waha-media';

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

/** How many media files a single sync may download. Keeps the request bounded. */
const MEDIA_BUDGET = 6;

/**
 * Which JID actually holds each conversation's chat. Resolving a Linked
 * ID costs two extra WAHA calls, and the answer never changes for a
 * contact — cache it so the periodic sync stays a single request.
 */
const chatIdCache = new Map<string, { chatId: string; at: number }>();
const CHAT_ID_TTL_MS = 30 * 60 * 1000;

/**
 * Engines report the same message as `ABC123` or
 * `true_5199…@c.us_ABC123`. Compare on the trailing id so a row saved
 * by the CRM send is recognised as the same message the history returns.
 */
function coreMessageId(id: string): string {
  const parsed = parseWahaSerializedId(id);
  return (parsed?.messageId ?? id).toUpperCase();
}

function readTimestamp(payload: Record<string, unknown>): string {
  const raw =
    typeof payload.timestamp === 'number'
      ? payload.timestamp
      : typeof payload.messageTimestamp === 'number'
        ? payload.messageTimestamp
        : null;
  if (raw == null) return new Date().toISOString();
  // Engines send seconds; guard against the occasional millisecond value.
  const ms = raw > 1e11 ? raw : raw * 1000;
  return new Date(ms).toISOString();
}

export interface SyncWahaConversationResult {
  inserted: number;
  scanned: number;
  chatId: string | null;
}

/**
 * Backfill a conversation from WAHA's chat history.
 *
 * `phone` is the contact's stored phone. Both `<digits>@c.us` and the
 * Linked ID WhatsApp may key the chat by are tried, because a chat that
 * only exists under `@lid` returns nothing for the `@c.us` id.
 */
export async function syncWahaConversation(params: {
  accountId: string;
  conversationId: string;
  phone: string;
  opts: WahaClientOptions;
  limit?: number;
}): Promise<SyncWahaConversationResult> {
  const { accountId, conversationId, phone, opts } = params;
  const limit = params.limit ?? 50;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return { inserted: 0, scanned: 0, chatId: null };

  const candidates: string[] = [];
  const cached = chatIdCache.get(conversationId);
  if (cached && Date.now() - cached.at < CHAT_ID_TTL_MS) {
    candidates.push(cached.chatId);
  }
  const plain = `${digits}@c.us`;
  if (!candidates.includes(plain)) candidates.push(plain);

  // First pass without media: asking WAHA to download every attachment
  // in the window would make a routine sync expensive, and most syncs
  // find nothing new.
  let payloads: Record<string, unknown>[] = [];
  let chatId: string | null = null;
  for (const candidate of candidates) {
    const rows = await fetchWahaChatMessages(opts, candidate, limit, false);
    if (rows.length) {
      payloads = rows;
      chatId = candidate;
      break;
    }
  }

  // Nothing under the phone JID — the chat may only exist as a Linked
  // ID. Resolving that costs extra calls, so it is a fallback, not the
  // default path, and the answer is cached for the next poll.
  if (!payloads.length) {
    try {
      const resolved = await resolveOutboundChatId(opts, digits);
      if (resolved && !candidates.includes(resolved)) {
        const rows = await fetchWahaChatMessages(opts, resolved, limit, false);
        if (rows.length) {
          payloads = rows;
          chatId = resolved;
        }
      }
    } catch {
      // check-exists / lids unavailable — nothing more to try.
    }
  }

  if (!payloads.length) return { inserted: 0, scanned: 0, chatId };
  if (chatId) chatIdCache.set(conversationId, { chatId, at: Date.now() });

  const { data: existingRows, error: existingErr } = await admin()
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (existingErr) {
    console.error('[waha-sync] existing ids lookup failed:', existingErr.message);
    return { inserted: 0, scanned: payloads.length, chatId };
  }

  const known = new Set<string>();
  for (const row of (existingRows ?? []) as Array<{ message_id: string | null }>) {
    if (row.message_id) known.add(coreMessageId(row.message_id));
  }

  const isNew = (payload: Record<string, unknown>): boolean => {
    const id = extractWahaMessageId(payload);
    return id !== null && !known.has(coreMessageId(id));
  };
  const newPayloads = payloads.filter(isNew);
  if (!newPayloads.length) {
    return { inserted: 0, scanned: payloads.length, chatId };
  }

  // Only pay for media downloads when something new actually carries an
  // attachment — then re-read the window with the files materialised.
  if (chatId && newPayloads.some((payload) => payload.hasMedia === true)) {
    const withMedia = await fetchWahaChatMessages(opts, chatId, limit, true);
    if (withMedia.length) payloads = withMedia;
  }

  let mediaBudget = MEDIA_BUDGET;
  const rows: Array<Record<string, unknown>> = [];
  let newest: { ts: string; text: string } | null = null;

  for (const payload of payloads) {
    const messageId = extractWahaMessageId(payload);
    if (!messageId) continue;
    const core = coreMessageId(messageId);
    if (known.has(core)) continue;
    known.add(core);

    const fromMe = isWahaFromMe(payload);
    const text = extractInboundText(payload);
    const media = readMediaRef(payload);
    const hasMedia = Boolean(media?.url);
    const adExtracted = extractAdContext(payload);
    if (!text && !hasMedia && !adExtracted) continue;

    let contentType = 'text';
    let contentText = text;
    let mediaUrl: string | null = null;

    if (hasMedia && media?.url) {
      contentType = mimeToContentType(media.mimetype);
      if (mediaBudget > 0) {
        mediaBudget -= 1;
        mediaUrl = await uploadWahaMedia(
          accountId,
          opts,
          media.url,
          media.mimetype,
          media.filename,
        );
      }
      if (!contentText) contentText = media.filename || `[${contentType}]`;
      // Without the file there is nothing to render — leave it for a
      // later sync rather than inserting an empty bubble. An ad card
      // still has something to show even if the attachment copy failed.
      if (!mediaUrl && !adExtracted) continue;
    }

    const adContext = adExtracted
      ? await persistAdCreativeSafe(accountId, adExtracted, opts)
      : null;
    if (!contentText && adContext) {
      contentText = adContext.headline || adContext.body || '[Facebook ad]';
    }

    const ts = readTimestamp(payload);
    rows.push({
      conversation_id: conversationId,
      sender_type: fromMe ? 'agent' : 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: messageId,
      status: fromMe ? 'sent' : 'delivered',
      created_at: ts,
      ad_context: adContext,
    });
    if (!newest || ts > newest.ts) {
      newest = { ts, text: contentText || `[${contentType}]` };
    }
  }

  if (!rows.length) return { inserted: 0, scanned: payloads.length, chatId };

  const { data: inserted, error: insertErr } = await admin()
    .from('messages')
    .upsert(rows, {
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    .select('id');

  if (insertErr) {
    console.error('[waha-sync] insert failed:', insertErr.message);
    return { inserted: 0, scanned: payloads.length, chatId };
  }

  const count = inserted?.length ?? 0;

  // Only move the conversation preview forward — a backfill of old
  // messages must not reorder the inbox list.
  if (count > 0 && newest) {
    const { data: conv } = await admin()
      .from('conversations')
      .select('last_message_at')
      .eq('id', conversationId)
      .maybeSingle();
    const current = conv?.last_message_at as string | null | undefined;
    const isNewer =
      !current || new Date(newest.ts).getTime() > new Date(current).getTime();
    if (isNewer) {
      await admin()
        .from('conversations')
        .update({
          last_message_text: newest.text,
          last_message_at: newest.ts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    }
  }

  return { inserted: count, scanned: payloads.length, chatId };
}
