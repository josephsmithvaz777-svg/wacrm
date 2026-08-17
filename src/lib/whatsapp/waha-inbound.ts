// ============================================================
// WAHA inbound event processing → contacts / conversations / messages
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  downloadWahaMedia,
  extractInboundText,
  resolveInboundChatId,
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

async function findOrCreateContact(
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
) {
  const existing = await findExistingContact(admin(), accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await admin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
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
    const id = typeof payload.id === 'string' ? payload.id : null;
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
  // includes outbound echoes — those are filtered via fromMe below.
  if (event.event !== 'message' && event.event !== 'message.any') return;

  const payload = event.payload || {};
  if (payload.fromMe === true) return;

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
    return;
  }

  const resolved = await resolveInboundChatId(opts, payload);
  if (!resolved) {
    console.warn(
      '[waha-inbound] skipping message — could not resolve phone from',
      payload.from || payload.chatId,
    );
    return;
  }

  const phone = normalizePhone(resolved.phone);
  if (!phone) return;

  // Mark CRM WhatsApp as connected once real traffic flows.
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

  const pushName =
    (typeof payload._data === 'object' &&
      payload._data &&
      typeof (payload._data as { notifyName?: string }).notifyName === 'string' &&
      (payload._data as { notifyName: string }).notifyName) ||
    phone;

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    phone,
    pushName,
  );
  if (!contactOutcome) return;

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contactOutcome.contact.id,
  );
  if (!convResult) return;

  if (convResult.created) {
    await dispatchWebhookEvent(admin(), config.account_id, 'conversation.created', {
      conversation_id: convResult.conversation.id,
      contact_id: contactOutcome.contact.id,
    });
  }

  const messageId =
    typeof payload.id === 'string' ? payload.id : `waha-${Date.now()}`;

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
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: messageId,
        status: 'delivered',
        created_at: ts,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (msgError) {
    console.error('[waha-inbound] message insert failed:', msgError);
    return;
  }
  if (!insertedRows || insertedRows.length === 0) return;

  await admin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: ts,
      updated_at: ts,
      unread_count: (convResult.conversation.unread_count || 0) + 1,
    })
    .eq('id', convResult.conversation.id);

  const messageDbId = insertedRows[0].id as string;
  const inboundText = contentText || '';

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
