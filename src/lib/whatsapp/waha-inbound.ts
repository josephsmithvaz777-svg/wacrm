// ============================================================
// WAHA inbound event processing → contacts / conversations / messages
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  downloadWahaMedia,
  extractInboundDisplayName,
  extractInboundText,
  extractWahaMeId,
  extractWahaMessageId,
  fetchContactDisplayName,
  isUsableDisplayName,
  isWahaFromMe,
  parseWahaSerializedId,
  pickOutboundChatJid,
  resolveInboundChatId,
  resolveWahaMeId,
  type WahaClientOptions,
} from '@/lib/whatsapp/waha-api';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { buildMediaPath } from '@/lib/storage/upload-media';

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

export interface WahaWebhookEvent {
  event: string;
  session: string;
  payload?: Record<string, unknown>;
  me?: { id?: string; pushName?: string };
}

function mimeToContentType(mime: string | null | undefined): string {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

async function uploadInboundMedia(
  accountId: string,
  opts: WahaClientOptions,
  mediaUrl: string,
  mime: string | null | undefined,
  filename: string | null | undefined,
): Promise<string | null> {
  try {
    const { buffer, contentType } = await downloadWahaMedia(opts, mediaUrl);
    const name = filename || `waha-${Date.now()}.${(mime || contentType).split('/')[1] || 'bin'}`;
    const path = buildMediaPath(accountId, name);
    const { error } = await admin()
      .storage.from('chat-media')
      .upload(path, buffer, {
        contentType: mime || contentType,
        upsert: false,
      });
    if (error) {
      console.error('[waha-inbound] storage upload failed:', error.message);
      return null;
    }
    const { data } = admin().storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl as string;
  } catch (err) {
    console.error('[waha-inbound] media download failed:', err);
    return null;
  }
}

function isPlaceholderContactName(name: string | null | undefined, phone: string): boolean {
  return !isUsableDisplayName(name, phone);
}

async function findOrCreateContact(
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
) {
  const existing = await findExistingContact(admin(), accountId, phone);
  if (existing) {
    const shouldUpdate =
      name &&
      !isPlaceholderContactName(name, phone) &&
      (name !== existing.name || isPlaceholderContactName(existing.name, phone));
    if (shouldUpdate && name !== existing.name) {
      await admin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return { contact: { ...existing, name }, wasCreated: false };
    }
    return { contact: existing, wasCreated: false };
  }

  const { data, error } = await admin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(admin(), accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('[waha-inbound] contact create failed:', error);
    return null;
  }
  return { contact: data, wasCreated: true };
}

async function findOrCreateConversation(
  accountId: string,
  ownerUserId: string,
  contactId: string,
) {
  const { data: rows, error } = await admin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[waha-inbound] conversation lookup failed:', error);
    return null;
  }

  if (rows?.[0]) {
    const conv = rows[0];
    if (conv.status === 'closed') {
      await reopenClosedConversation(admin(), conv);
      conv.status = 'open';
    }
    return { conversation: conv, created: false };
  }

  const { data: created, error: createErr } = await admin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      status: 'open',
    })
    .select()
    .single();

  if (createErr) {
    if (isUniqueViolation(createErr)) {
      const { data: raced } = await admin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced?.[0]) return { conversation: raced[0], created: false };
    }
    console.error('[waha-inbound] conversation create failed:', createErr);
    return null;
  }
  return { conversation: created, created: true };
}

/**
 * When WAHA only gives a Linked ID (`123@lid`) and the lids API cannot
 * map it to a phone, reuse the conversation that already stored an
 * inbound message with that JID in `messages.message_id`
 * (`false_123@lid_…` / `true_123@lid_…`).
 */
async function findConversationByRemoteJid(accountId: string, remoteJid: string) {
  const needle = remoteJid.replace(/[%\\]/g, '').trim();
  if (needle.length < 6) return null;

  const { data: msgs, error } = await admin()
    .from('messages')
    .select('conversation_id')
    .like('message_id', `%${needle}%`)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    console.warn('[waha-inbound] remote-jid lookup failed:', error.message);
    return null;
  }
  const ids = [
    ...new Set(
      (msgs ?? [])
        .map((row: { conversation_id?: string }) => row.conversation_id)
        .filter((id: string | undefined): id is string => Boolean(id)),
    ),
  ];
  if (!ids.length) return null;

  const { data: convs } = await admin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .in('id', ids)
    .limit(1);

  return convs?.[0] ?? null;
}

/**
 * GOWS emits `engine.event` / `events.Message` with Info.Chat + Info.IsFromMe.
 * The Event Monitor shows those even when `message.any` already fired —
 * treat them as a message.any payload so phone sends aren't dropped if
 * only the engine event reaches the CRM webhook.
 */
function unwrapEngineMessageEvent(
  event: WahaWebhookEvent,
): WahaWebhookEvent {
  if (event.event !== 'engine.event') return event;
  const payload = event.payload || {};
  const name = String(payload.event ?? payload.name ?? '');
  if (name !== 'events.Message' && !name.endsWith('.Message')) return event;

  const data = (
    payload.data && typeof payload.data === 'object' ? payload.data : payload
  ) as Record<string, unknown>;
  const info =
    data.Info && typeof data.Info === 'object'
      ? (data.Info as Record<string, unknown>)
      : null;
  if (!info) return event;

  const chat = typeof info.Chat === 'string' ? info.Chat : null;
  const sender = typeof info.Sender === 'string' ? info.Sender : null;
  const isFromMe = info.IsFromMe === true || info.isFromMe === true;
  const rawId =
    (typeof info.ID === 'string' && info.ID) ||
    (typeof info.Id === 'string' && info.Id) ||
    null;
  const serialized =
    chat && rawId
      ? `${isFromMe ? 'true' : 'false'}_${chat}_${rawId}`
      : undefined;

  return {
    ...event,
    event: 'message.any',
    payload: {
      ...payload,
      fromMe: isFromMe,
      from: isFromMe ? chat : sender || chat,
      to: isFromMe ? chat : undefined,
      chatId: chat,
      id: serialized,
      _data: data,
    },
  };
}

export async function processWahaEvent(
  event: WahaWebhookEvent,
  config: {
    account_id: string;
    user_id: string;
    waha_base_url: string;
    waha_session: string;
    access_token: string | null;
  },
): Promise<void> {
  event = unwrapEngineMessageEvent(event);
  const opts: WahaClientOptions = {
    baseUrl: config.waha_base_url,
    apiKey: config.access_token,
    session: config.waha_session || 'default',
  };

  if (event.event === 'session.status') {
    const status = String(
      (event.payload as { status?: string } | undefined)?.status || '',
    ).toUpperCase();
    if (status === 'WORKING') {
      await admin()
        .from('whatsapp_config')
        .update({
          status: 'connected',
          connected_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          last_registration_error: null,
        })
        .eq('account_id', config.account_id);
    } else if (status === 'FAILED' || status === 'STOPPED') {
      await admin()
        .from('whatsapp_config')
        .update({ status: 'disconnected' })
        .eq('account_id', config.account_id);
    }
    return;
  }

  if (event.event === 'message.ack') {
    const payload = event.payload || {};
    const id = extractWahaMessageId(payload);
    const ack = typeof payload.ack === 'number' ? payload.ack : null;
    if (!id || ack == null) return;
    // WAHA ack: 0 ERROR/PENDING, 1 SERVER, 2 DEVICE, 3 READ, 4 PLAYED
    const status =
      ack >= 3 ? 'read' : ack === 2 ? 'delivered' : ack >= 1 ? 'sent' : null;
    if (!status) return;
    await admin()
      .from('messages')
      .update({ status })
      .eq('message_id', id);
    return;
  }

  // GOWS/WEBJS: inbound texts arrive as `message`; `message.any` also
  // includes outbound echoes. Persist those as agent messages so sends
  // from the CRM (and from the linked WhatsApp session) show in the
  // thread — skipping fromMe was dropping every outgoing bubble.
  if (event.event !== 'message' && event.event !== 'message.any') return;

  const payload = event.payload || {};
  const fromMe = isWahaFromMe(payload);

  // Ignore empty protocol/sync noise (no body, no media).
  const bodyText = extractInboundText(payload);
  const hasMedia = payload.hasMedia === true;
  const media =
    payload.media && typeof payload.media === 'object'
      ? (payload.media as {
          url?: string;
          mimetype?: string;
          filename?: string | null;
        })
      : null;
  if (!bodyText && !(hasMedia && media?.url)) {
    if (fromMe) {
      console.warn(
        '[waha-inbound] fromMe echo ignored (no text/media)',
        extractWahaMessageId(payload),
      );
    }
    return;
  }

  const fromRaw =
    typeof payload.from === 'string'
      ? payload.from
      : typeof payload.chatId === 'string'
        ? payload.chatId
        : typeof payload.to === 'string'
          ? payload.to
          : null;
  // Groups / status / newsletters are not 1:1 inbox chats — skip quietly.
  // For fromMe, `from` may be our own JID; don't treat that as a group skip.
  if (
    !fromMe &&
    fromRaw &&
    (fromRaw.endsWith('@g.us') ||
      fromRaw.endsWith('@newsletter') ||
      fromRaw === 'status@broadcast')
  ) {
    return;
  }

  const meId = fromMe
    ? await resolveWahaMeId(opts, extractWahaMeId(event.me))
    : extractWahaMeId(event.me);

  const remoteHint =
    (fromMe ? pickOutboundChatJid(payload, meId) : fromRaw) ||
    (typeof payload.id === 'string'
      ? parseWahaSerializedId(payload.id)?.remoteJid ?? null
      : null);

  const resolved = await resolveInboundChatId(opts, payload, {
    fromMe,
    meId,
  });

  let contactOutcome: {
    contact: { id: string };
    wasCreated: boolean;
  } | null = null;
  let convResult: {
    conversation: {
      id: string;
      contact_id?: string;
      unread_count?: number;
      assigned_agent_id?: string | null;
      status?: string;
    };
    created: boolean;
  } | null = null;

  if (resolved) {
    const phone = normalizePhone(resolved.phone);
    if (phone) {
      await admin()
        .from('whatsapp_config')
        .update({
          status: 'connected',
          connected_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          last_registration_error: null,
        })
        .eq('account_id', config.account_id)
        .eq('provider', 'waha');

      const fromPayload = extractInboundDisplayName(payload, phone);
      const fromApi =
        (isUsableDisplayName(fromPayload, phone) ? fromPayload : null) ||
        (await fetchContactDisplayName(opts, resolved.chatId, phone)) ||
        (await fetchContactDisplayName(opts, phone, phone));
      const pushName = fromApi || phone;

      const createdContact = await findOrCreateContact(
        config.account_id,
        config.user_id,
        phone,
        pushName,
      );
      if (createdContact) {
        contactOutcome = {
          contact: { id: createdContact.contact.id },
          wasCreated: createdContact.wasCreated,
        };
        convResult = await findOrCreateConversation(
          config.account_id,
          config.user_id,
          createdContact.contact.id,
        );
      }
    }
  }

  // LID chats: WAHA Event Monitor shows `true_1840…@lid_…` but the lids
  // API often cannot map that to a phone. If this thread already has an
  // inbound whose message_id contains the same JID, attach there.
  if (!convResult && remoteHint) {
    const existing = await findConversationByRemoteJid(
      config.account_id,
      remoteHint,
    );
    if (existing?.id && existing.contact_id) {
      contactOutcome = {
        contact: { id: existing.contact_id as string },
        wasCreated: false,
      };
      convResult = { conversation: existing, created: false };
    }
  }

  if (!convResult || !contactOutcome) {
    console.warn(
      '[waha-inbound] skipping message — could not resolve chat',
      {
        event: event.event,
        fromMe,
        fromRaw,
        remoteHint,
      },
    );
    return;
  }

  if (convResult.created) {
    await dispatchWebhookEvent(admin(), config.account_id, 'conversation.created', {
      conversation_id: convResult.conversation.id,
      contact_id: contactOutcome.contact.id,
    });
    try {
      const { maybeRoundRobinAssignNewConversation } = await import(
        '@/lib/assignments/round-robin'
      );
      await maybeRoundRobinAssignNewConversation(admin(), {
        accountId: config.account_id,
        contactId: contactOutcome.contact.id,
        conversationId: convResult.conversation.id,
        alreadyAssigned: convResult.conversation.assigned_agent_id ?? null,
      });
    } catch (err) {
      console.warn('[waha-inbound] round-robin assign failed:', err);
    }
  }

  const messageId = extractWahaMessageId(payload) || `waha-${Date.now()}`;

  let contentType = 'text';
  let contentText = bodyText;
  let mediaUrl: string | null = null;

  if (hasMedia && media?.url) {
    contentType = mimeToContentType(media.mimetype);
    mediaUrl = await uploadInboundMedia(
      config.account_id,
      opts,
      media.url,
      media.mimetype,
      media.filename,
    );
    if (!contentText) contentText = media.filename || `[${contentType}]`;
  }

  const ts =
    typeof payload.timestamp === 'number'
      ? new Date(payload.timestamp * 1000).toISOString()
      : new Date().toISOString();

  const { data: insertedRows, error: msgError } = await admin()
    .from('messages')
    .upsert(
      {
        conversation_id: convResult.conversation.id,
        sender_type: fromMe ? 'agent' : 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: messageId,
        status: fromMe ? 'sent' : 'delivered',
        created_at: ts,
      },
      {
        onConflict: 'conversation_id,message_id',
        // Inbound must not overwrite an agent row if the CRM send won
        // the race. Outbound echoes SHOULD overwrite a customer row
        // that was mis-attributed when fromMe wasn't detected.
        ignoreDuplicates: !fromMe,
      },
    )
    .select('id');

  if (msgError) {
    console.error('[waha-inbound] message insert failed:', msgError);
    return;
  }
  if (!insertedRows || insertedRows.length === 0) return;

  const convUpdate: Record<string, unknown> = {
    last_message_text: contentText || `[${contentType}]`,
    last_message_at: ts,
    updated_at: ts,
  };
  if (!fromMe) {
    convUpdate.unread_count = (convResult.conversation.unread_count || 0) + 1;
  }

  await admin()
    .from('conversations')
    .update(convUpdate)
    .eq('id', convResult.conversation.id);

  const messageDbId = insertedRows[0].id as string;
  const inboundText = contentText || '';

  // Outbound echoes are already in the thread (CRM send and/or this
  // row). Don't fire inbound automations, AI, or message.received.
  if (fromMe) return;

  try {
    const flowResult = await dispatchInboundToFlows({
      accountId: config.account_id,
      userId: config.user_id,
      contactId: contactOutcome.contact.id,
      conversationId: convResult.conversation.id,
      isFirstInboundMessage: contactOutcome.wasCreated,
      message: {
        kind: 'text',
        text: inboundText,
        meta_message_id: messageId,
      },
    });

    const automationTriggers: Array<
      | 'new_contact_created'
      | 'first_inbound_message'
      | 'new_message_received'
      | 'keyword_match'
    > = ['new_message_received', 'keyword_match'];
    if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created');
    automationTriggers.push('first_inbound_message');

    for (const triggerType of automationTriggers) {
      await runAutomationsForTrigger({
        accountId: config.account_id,
        triggerType,
        contactId: contactOutcome.contact.id,
        context: {
          message_text: inboundText,
          conversation_id: convResult.conversation.id,
        },
      });
    }

    if (!flowResult.consumed && inboundText.trim()) {
      await dispatchInboundToAiReply({
        accountId: config.account_id,
        conversationId: convResult.conversation.id,
        contactId: contactOutcome.contact.id,
        configOwnerUserId: config.user_id,
      });
    }

    await dispatchWebhookEvent(admin(), config.account_id, 'message.received', {
      conversation_id: convResult.conversation.id,
      contact_id: contactOutcome.contact.id,
      message_id: messageDbId,
    });
  } catch (err) {
    console.error('[waha-inbound] fan-out error:', err);
  }
}
