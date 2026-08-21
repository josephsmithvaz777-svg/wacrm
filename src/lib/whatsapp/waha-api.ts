// ============================================================
// WAHA (WhatsApp HTTP API) client — MVP transport.
// Docs: https://waha.devlike.pro/
// ============================================================

import { wahaPayloadIsGroup } from '@/lib/whatsapp/chat-kind';

export type WahaSessionStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | string;

export interface WahaClientOptions {
  baseUrl: string;
  apiKey?: string | null;
  session?: string;
}

export class WahaApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`WAHA API ${status}: ${body}`);
    this.name = 'WahaApiError';
    this.status = status;
    this.body = body;
  }
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function headers(apiKey?: string | null): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) h['X-Api-Key'] = apiKey;
  return h;
}

async function wahaFetch(
  opts: WahaClientOptions,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = normalizeBaseUrl(opts.baseUrl);
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...headers(opts.apiKey),
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@c.us`;
}

export function chatIdToPhone(chatId: string): string {
  const raw = chatId.split('@')[0] || chatId;
  return raw.replace(/\D/g, '');
}

/**
 * Resolve the chatId WAHA/WEBJS expects for outbound sends.
 * Modern WhatsApp often requires `@lid` — sending only `@c.us` yields
 * "No LID for user" on WEBJS.
 */
export async function resolveOutboundChatId(
  opts: WahaClientOptions,
  toPhone: string,
): Promise<string> {
  const digits = toPhone.replace(/\D/g, '');
  // E.164 max is 15 digits. Longer values are almost always Linked IDs
  // wrongly stored as phones — WEBJS then fails with "No LID for user".
  if (digits.length < 8 || digits.length > 15) {
    throw new WahaApiError(
      400,
      `Invalid phone for WAHA send (len=${digits.length}): ${digits.slice(0, 20)}`,
    );
  }
  const session = opts.session || 'default';
  const fallback = `${digits}@c.us`;

  try {
    const res = await wahaFetch(
      opts,
      `/api/contacts/check-exists?phone=${encodeURIComponent(digits)}&session=${encodeURIComponent(session)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as {
        numberExists?: boolean;
        chatId?: string;
      };
      if (json.numberExists && typeof json.chatId === 'string' && json.chatId) {
        return json.chatId;
      }
    }
  } catch (err) {
    console.warn('[waha] check-exists failed:', err);
  }

  try {
    const encoded = encodeURIComponent(`${digits}@c.us`);
    const res = await wahaFetch(
      opts,
      `/api/${encodeURIComponent(session)}/lids/pn/${encoded}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { lid?: string | null };
      if (typeof json.lid === 'string' && json.lid.includes('@lid')) {
        return json.lid;
      }
    }
  } catch (err) {
    console.warn('[waha] lids/pn resolve failed:', err);
  }

  return fallback;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function idFromObject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  return firstNonEmptyString(o._serialized, o.id);
}

/**
 * Stable WhatsApp message id across WAHA engines (WEBJS string ids,
 * GOWS `{ _serialized, id }` objects, `key.id`, arrays).
 * Returns null when the payload has no usable id — callers that must
 * persist a row can fall back to a synthetic `waha-${Date.now()}`.
 */
export function extractWahaMessageId(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (Array.isArray(payload)) return extractWahaMessageId(payload[0]);
  if (typeof payload !== 'object') return null;

  const p = payload as Record<string, unknown>;
  if (typeof p.id === 'string' && p.id.trim()) return p.id;
  const fromId = idFromObject(p.id);
  if (fromId) return fromId;
  const fromKey = idFromObject(p.key);
  if (fromKey) return fromKey;
  if (typeof p.messageId === 'string' && p.messageId.trim()) return p.messageId;
  if (Array.isArray(p.ids)) return extractWahaMessageId(p.ids[0]);
  return null;
}

function extractMessageId(payload: unknown): string {
  return extractWahaMessageId(payload) || `waha-${Date.now()}`;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

/**
 * WEBJS serializes ids as `{true|false}_{remoteJid}_{messageId}`.
 * Event Monitor shows e.g. `true_184086660382908@lid_A54F679B…` — the
 * remote JID is often a Linked ID, not a phone `@c.us`.
 */
export function parseWahaSerializedId(
  id: string,
): { fromMe: boolean; remoteJid: string; messageId: string } | null {
  const match = /^(true|false)_(.+)_([^_]+)$/.exec(id);
  if (!match) return null;
  const remoteJid = match[2];
  if (!remoteJid.includes('@') && !/^\d{8,}$/.test(remoteJid)) return null;
  return {
    fromMe: match[1] === 'true',
    remoteJid,
    messageId: match[3],
  };
}

function remoteJidFromSerializedPayload(
  payload: Record<string, unknown>,
): string | null {
  if (typeof payload.id === 'string') {
    return parseWahaSerializedId(payload.id)?.remoteJid ?? null;
  }
  if (payload.id && typeof payload.id === 'object') {
    const serialized = (payload.id as Record<string, unknown>)._serialized;
    if (typeof serialized === 'string') {
      return parseWahaSerializedId(serialized)?.remoteJid ?? null;
    }
  }
  return null;
}

/**
 * True when a WAHA message was sent by the connected session.
 * Engines disagree on where `fromMe` lives — WEBJS puts it on the
 * payload, GOWS often nests it under `id` / `key` / `_data.Info`.
 */
export function isWahaFromMe(payload: Record<string, unknown>): boolean {
  if (isTruthyFlag(payload.fromMe)) return true;

  if (typeof payload.id === 'string' && payload.id.startsWith('true_')) {
    return true;
  }

  if (payload.id && typeof payload.id === 'object') {
    const id = payload.id as Record<string, unknown>;
    if (isTruthyFlag(id.fromMe)) return true;
    if (typeof id._serialized === 'string' && id._serialized.startsWith('true_')) {
      return true;
    }
  }

  if (payload.key && typeof payload.key === 'object') {
    const key = payload.key as Record<string, unknown>;
    if (isTruthyFlag(key.fromMe)) return true;
  }

  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  if (data) {
    if (isTruthyFlag(data.fromMe)) return true;
    if (data.key && typeof data.key === 'object') {
      const key = data.key as Record<string, unknown>;
      if (isTruthyFlag(key.fromMe)) return true;
    }
    if (data.id && typeof data.id === 'object') {
      const id = data.id as Record<string, unknown>;
      if (isTruthyFlag(id.fromMe)) return true;
    }
    if (data.Info && typeof data.Info === 'object') {
      const info = data.Info as Record<string, unknown>;
      if (isTruthyFlag(info.IsFromMe) || isTruthyFlag(info.isFromMe)) {
        return true;
      }
    }
  }

  return false;
}

function isSessionMeJid(
  jid: string | null | undefined,
  meId: string | null | undefined,
): boolean {
  if (!jid || !meId) return false;
  const left = chatIdToPhone(jid);
  const right = chatIdToPhone(meId);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

/** Best-effort id from WAHA `me` (webhook `event.me` or `GET /sessions`). */
export function extractWahaMeId(me: unknown): string | null {
  if (!me) return null;
  if (typeof me === 'string' && me.trim()) return me.trim();
  if (typeof me !== 'object') return null;
  const o = me as Record<string, unknown>;
  return firstNonEmptyString(o.id, o.jid, o.lid);
}

export async function getSession(
  opts: WahaClientOptions,
): Promise<{ name: string; status: WahaSessionStatus; me?: unknown } | null> {
  const session = opts.session || 'default';
  const res = await wahaFetch(opts, `/api/sessions/${encodeURIComponent(session)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new WahaApiError(res.status, await res.text());
  }
  return (await res.json()) as {
    name: string;
    status: WahaSessionStatus;
    me?: unknown;
  };
}

/**
 * Events the CRM webhook must be subscribed to. `message` is
 * inbound-only on most engines: phone-sent echoes arrive on
 * `message.any` (and on `engine.event` for GOWS). A session created
 * before this list grew keeps its old subscription until it is
 * updated, so `ensureWebhookSubscription` repairs it in place.
 */
export const WAHA_WEBHOOK_EVENTS = [
  'message',
  'message.any',
  'message.ack',
  'session.status',
  'engine.event',
] as const;

function sameWebhookUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

interface WahaSessionConfig {
  webhooks?: Array<{ url?: string; events?: string[] }>;
  [key: string]: unknown;
}

/**
 * WAHA's NOWEB engine only keeps chat history when its store is
 * enabled. Without it `fetchWahaChatMessages` comes back empty and a
 * message the webhook missed is unrecoverable. Other engines ignore the
 * key. Applied only when the session config is being written anyway —
 * WAHA does not always echo the value back, so treating it as a repair
 * trigger would restart the session on every check.
 */
function withHistoryStore(config: WahaSessionConfig): WahaSessionConfig {
  const noweb =
    config.noweb && typeof config.noweb === 'object'
      ? (config.noweb as Record<string, unknown>)
      : {};
  const store =
    noweb.store && typeof noweb.store === 'object'
      ? (noweb.store as Record<string, unknown>)
      : {};
  return {
    ...config,
    noweb: { ...noweb, store: { fullSync: false, ...store, enabled: true } },
  };
}

async function getSessionConfig(
  opts: WahaClientOptions,
): Promise<WahaSessionConfig | null> {
  const session = opts.session || 'default';
  const res = await wahaFetch(
    opts,
    `/api/sessions/${encodeURIComponent(session)}`,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { config?: WahaSessionConfig };
  return json.config ?? null;
}

/**
 * Make sure the live session actually delivers every event the CRM
 * needs to `webhookUrl`. WAHA's Event Monitor shows all engine events
 * regardless of the webhook config, so a session subscribed only to
 * `message` looks healthy there while phone-sent messages never reach
 * the CRM. Only PUTs when something is missing — the update restarts
 * the session (auth is preserved, no new QR).
 */
export async function ensureWebhookSubscription(
  opts: WahaClientOptions,
  webhookUrl: string,
): Promise<{ repaired: boolean; events: string[] }> {
  const session = opts.session || 'default';
  const config = await getSessionConfig(opts);
  const rawWebhooks = config?.webhooks;
  const webhooks = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const mine = webhooks.find(
    (hook) => typeof hook?.url === 'string' && sameWebhookUrl(hook.url, webhookUrl),
  );
  const current = mine && Array.isArray(mine.events) ? mine.events : [];
  const missing = WAHA_WEBHOOK_EVENTS.filter(
    (event) => !current.includes(event),
  );
  if (mine && missing.length === 0) {
    return { repaired: false, events: current };
  }

  const events = [...WAHA_WEBHOOK_EVENTS];
  const others = webhooks.filter(
    (hook) =>
      typeof hook?.url === 'string' && !sameWebhookUrl(hook.url, webhookUrl),
  );
  const res = await wahaFetch(opts, `/api/sessions/${encodeURIComponent(session)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: session,
      config: withHistoryStore({
        ...(config ?? {}),
        webhooks: [...others, { url: webhookUrl, events }],
      }),
    }),
  });
  if (!res.ok) {
    throw new WahaApiError(res.status, await res.text());
  }
  return { repaired: true, events };
}

/**
 * Recent messages for a chat, straight from WAHA. Used to backfill the
 * thread when a webhook delivery was missed or the chat could not be
 * resolved — the engine's own history is the source of truth.
 * Returns raw payloads shaped like the webhook `message` payload, so
 * the same extractors apply.
 */
export async function fetchWahaChatMessages(
  opts: WahaClientOptions,
  chatId: string,
  limit = 50,
  downloadMedia = true,
): Promise<Record<string, unknown>[]> {
  const session = opts.session || 'default';
  const query = `limit=${limit}&downloadMedia=${downloadMedia ? 'true' : 'false'}`;
  const paths = [
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?${query}`,
    `/api/messages?session=${encodeURIComponent(session)}&chatId=${encodeURIComponent(chatId)}&${query}`,
  ];

  for (const path of paths) {
    try {
      const res = await wahaFetch(opts, path);
      if (!res.ok) continue;
      const json = await res.json();
      const list = Array.isArray(json)
        ? json
        : Array.isArray((json as { messages?: unknown }).messages)
          ? (json as { messages: unknown[] }).messages
          : null;
      if (!list) continue;
      return list.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object',
      );
    } catch (err) {
      console.warn('[waha] chat messages fetch failed:', err);
    }
  }
  return [];
}

export async function ensureSession(
  opts: WahaClientOptions,
  webhookUrl: string,
): Promise<{ name: string; status: WahaSessionStatus }> {
  const session = opts.session || 'default';
  const existing = await getSession(opts);
  // Reuse whatever the session already carries (proxy, metadata, store
  // settings) so updating the webhooks can't silently reset it.
  const previous = existing ? await getSessionConfig(opts) : null;
  const config = withHistoryStore({
    ...(previous ?? {}),
    webhooks: [
      {
        url: webhookUrl,
        events: [...WAHA_WEBHOOK_EVENTS],
      },
    ],
  });

  if (!existing) {
    const res = await wahaFetch(opts, '/api/sessions/', {
      method: 'POST',
      body: JSON.stringify({
        name: session,
        start: true,
        config,
      }),
    });
    if (!res.ok) {
      throw new WahaApiError(res.status, await res.text());
    }
    const created = (await res.json()) as {
      name: string;
      status: WahaSessionStatus;
    };
    return { name: created.name || session, status: created.status };
  }

  // Update webhooks + restart if stopped.
  const put = await wahaFetch(opts, `/api/sessions/${encodeURIComponent(session)}`, {
    method: 'PUT',
    body: JSON.stringify({ name: session, config }),
  });
  // Some engines use POST for update — fall through if PUT unsupported.
  if (!put.ok && put.status !== 404 && put.status !== 405) {
    // Non-fatal: session may already be fine; try start.
    console.warn('[waha] session update failed:', put.status, await put.text());
  }

  if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
    const start = await wahaFetch(
      opts,
      `/api/sessions/${encodeURIComponent(session)}/start`,
      { method: 'POST' },
    );
    if (!start.ok) {
      throw new WahaApiError(start.status, await start.text());
    }
    const started = (await start.json()) as { status?: WahaSessionStatus };
    return { name: session, status: started.status || 'STARTING' };
  }

  return { name: session, status: existing.status };
}

const meIdCache = new Map<string, { id: string; at: number }>();
const ME_ID_TTL_MS = 5 * 60 * 1000;

/**
 * Session's own JID — needed to tell the contact apart from us on
 * fromMe echoes. Prefer the webhook `me` field; fall back to GET session
 * (cached) because some engines omit `me` on message.any.
 */
export async function resolveWahaMeId(
  opts: WahaClientOptions,
  eventMeId?: string | null,
): Promise<string | null> {
  if (eventMeId) return eventMeId;
  const key = `${normalizeBaseUrl(opts.baseUrl)}|${opts.session || 'default'}`;
  const cached = meIdCache.get(key);
  if (cached && Date.now() - cached.at < ME_ID_TTL_MS) return cached.id;
  try {
    const session = await getSession(opts);
    const id = extractWahaMeId(session?.me);
    if (id) meIdCache.set(key, { id, at: Date.now() });
    return id;
  } catch (err) {
    console.warn('[waha] resolve me id failed:', err);
    return cached?.id ?? null;
  }
}

/**
 * Returns a data-URL (image) or raw base64 string for the QR code.
 */
export async function getQrDataUrl(opts: WahaClientOptions): Promise<string> {
  const session = opts.session || 'default';
  // Prefer image format when supported.
  const res = await wahaFetch(
    opts,
    `/api/${encodeURIComponent(session)}/auth/qr?format=image`,
    { method: 'GET' },
  );

  if (res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { data?: string; qr?: string };
      const raw = json.data || json.qr;
      if (raw?.startsWith('data:')) return raw;
      if (raw) return `data:image/png;base64,${raw}`;
    }
    if (contentType.includes('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${buf.toString('base64')}`;
    }
  }

  // Fallback: POST without format (older WAHA).
  const res2 = await wahaFetch(opts, `/api/${encodeURIComponent(session)}/auth/qr`, {
    method: 'POST',
  });
  if (!res2.ok) {
    throw new WahaApiError(res2.status, await res2.text());
  }
  const contentType = res2.headers.get('content-type') || '';
  if (contentType.includes('image/')) {
    const buf = Buffer.from(await res2.arrayBuffer());
    return `data:${contentType};base64,${buf.toString('base64')}`;
  }
  const json = (await res2.json()) as { data?: string; qr?: string };
  const raw = json.data || json.qr;
  if (!raw) throw new WahaApiError(500, 'QR payload missing');
  return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

export async function sendWahaText(
  opts: WahaClientOptions,
  toPhone: string,
  text: string,
  replyTo?: string | null,
): Promise<{ messageId: string }> {
  const chatId = await resolveOutboundChatId(opts, toPhone);
  const body: Record<string, unknown> = {
    session: opts.session || 'default',
    chatId,
    text,
  };
  if (replyTo) {
    body.reply_to = replyTo;
  }
  const res = await wahaFetch(opts, '/api/sendText', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new WahaApiError(res.status, await res.text());
  const payload = await readJsonOrText(res);
  return { messageId: extractMessageId(payload) };
}

export async function sendWahaMedia(
  opts: WahaClientOptions,
  toPhone: string,
  kind: 'image' | 'video' | 'document' | 'audio',
  link: string,
  caption?: string | null,
  filename?: string | null,
): Promise<{ messageId: string }> {
  const session = opts.session || 'default';
  const chatId = await resolveOutboundChatId(opts, toPhone);
  const file: Record<string, string> = { url: link };
  if (filename) file.filename = filename;

  let path = '/api/sendFile';
  const body: Record<string, unknown> = { session, chatId, file };
  if (kind === 'image') {
    path = '/api/sendImage';
    if (caption) body.caption = caption;
  } else if (kind === 'video') {
    path = '/api/sendVideo';
    if (caption) body.caption = caption;
  } else if (kind === 'audio') {
    path = '/api/sendVoice';
  } else {
    path = '/api/sendFile';
    if (caption) body.caption = caption;
  }

  const res = await wahaFetch(opts, path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new WahaApiError(res.status, await res.text());
  const payload = await readJsonOrText(res);
  return { messageId: extractMessageId(payload) };
}

export async function sendWahaReaction(
  opts: WahaClientOptions,
  toPhone: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const chatId = await resolveOutboundChatId(opts, toPhone);
  const res = await wahaFetch(opts, '/api/reaction', {
    method: 'PUT',
    body: JSON.stringify({
      session: opts.session || 'default',
      chatId,
      messageId,
      reaction: emoji,
    }),
  });
  if (!res.ok) throw new WahaApiError(res.status, await res.text());
}

export async function downloadWahaMedia(
  opts: WahaClientOptions,
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const headersInit: Record<string, string> = {};
  if (opts.apiKey) headersInit['X-Api-Key'] = opts.apiKey;

  // Absolute URL from WAHA may point at internal host — rewrite to baseUrl origin when needed.
  let url = mediaUrl;
  try {
    const parsed = new URL(mediaUrl);
    const base = new URL(normalizeBaseUrl(opts.baseUrl));
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    ) {
      parsed.protocol = base.protocol;
      parsed.host = base.host;
      url = parsed.toString();
    }
  } catch {
    // relative path
    url = `${normalizeBaseUrl(opts.baseUrl)}${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
  }

  const res = await fetch(url, { headers: headersInit });
  if (!res.ok) throw new WahaApiError(res.status, await res.text());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/**
 * Resolve WhatsApp Linked ID (`123@lid`) to a phone chat id (`5199…@c.us`).
 * Returns null when WAHA cannot map it (common for some privacy/group cases).
 */
export async function resolveLidToPhone(
  opts: WahaClientOptions,
  lidOrChatId: string,
): Promise<string | null> {
  const session = opts.session || 'default';
  const digits = lidOrChatId.replace(/\D/g, '');
  const lid = lidOrChatId.includes('@')
    ? lidOrChatId
    : `${digits}@lid`;

  const tryParsePn = (json: unknown): string | null => {
    if (!json || typeof json !== 'object') return null;
    const o = json as Record<string, unknown>;
    const pn = o.pn ?? o.number ?? o.phone;
    if (typeof pn === 'string' && pn.includes('@c.us')) return pn;
    if (typeof pn === 'string' && /^\d{8,15}$/.test(pn.replace(/\D/g, ''))) {
      return `${pn.replace(/\D/g, '')}@c.us`;
    }
    const id = o.id;
    if (typeof id === 'string' && id.endsWith('@c.us')) return id;
    return null;
  };

  // 1) Lids API — full lid, then digits-only.
  for (const key of [lid, digits]) {
    try {
      const res = await wahaFetch(
        opts,
        `/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(key)}`,
      );
      if (res.ok) {
        const parsed = tryParsePn(await res.json());
        if (parsed) return parsed;
      }
    } catch (err) {
      console.warn('[waha] lids resolve error:', err);
    }
  }

  // 2) Contacts API with the lid / digits.
  for (const contactId of [lid, digits]) {
    try {
      const res = await wahaFetch(
        opts,
        `/api/contacts?contactId=${encodeURIComponent(contactId)}&session=${encodeURIComponent(session)}`,
      );
      if (res.ok) {
        const parsed = tryParsePn(await res.json());
        if (parsed) return parsed;
      }
    } catch (err) {
      console.warn('[waha] contacts resolve error:', err);
    }
  }

  return null;
}

/**
 * True when a string is usable as a contact display name (not phone / junk).
 */
export function isUsableDisplayName(
  name: string | null | undefined,
  phone?: string,
): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed === '~' || trimmed === '.' || trimmed === '..' || trimmed === '-') {
    return false;
  }
  // Punctuation / emoji-only placeholders.
  if (!/[A-Za-zÀ-ÿ0-9]/.test(trimmed)) return false;
  if (/^[\s._\-•·]+$/.test(trimmed)) return false;
  const nameDigits = trimmed.replace(/\D/g, '');
  if (phone) {
    const phoneDigits = phone.replace(/\D/g, '');
    if (
      nameDigits &&
      phoneDigits &&
      nameDigits === phoneDigits &&
      !/[A-Za-zÀ-ÿ]/.test(trimmed)
    ) {
      return false;
    }
  }
  // Pure long digit strings are phones / LIDs, not names.
  if (/^\d{6,}$/.test(nameDigits) && !/[A-Za-zÀ-ÿ]/.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Best-effort display name from a WAHA inbound message payload.
 * Engines differ: WEBJS often uses notifyName; NOWEB/GOWS use pushName.
 */
export function extractInboundDisplayName(
  payload: Record<string, unknown>,
  phone?: string,
): string | null {
  const candidates: unknown[] = [
    payload.notifyName,
    payload.pushName,
    payload.pushname,
    payload.senderName,
    payload.authorName,
  ];
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  if (data) {
    candidates.push(
      data.notifyName,
      data.pushName,
      data.pushname,
      data.verifiedBizName,
      data.verifiedName,
    );
    const info =
      data.Info && typeof data.Info === 'object'
        ? (data.Info as Record<string, unknown>)
        : null;
    if (info) candidates.push(info.PushName, info.pushName);
  }

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    if (isUsableDisplayName(c, phone)) return c.trim();
  }
  return null;
}

/** Look up saved WhatsApp contact name / pushname via WAHA Contacts / Chats API. */
export async function fetchContactDisplayName(
  opts: WahaClientOptions,
  chatIdOrPhone: string,
  phone?: string,
): Promise<string | null> {
  const session = opts.session || 'default';
  const digits = chatIdOrPhone.replace(/\D/g, '');
  const phoneHint = phone || digits;
  const contactIds = [
    chatIdOrPhone.includes('@') ? chatIdOrPhone : `${digits}@c.us`,
    digits,
  ];

  const pickName = (json: Record<string, unknown>): string | null => {
    for (const key of [
      'name',
      'pushname',
      'pushName',
      'shortName',
      'shortname',
      'verifiedName',
    ]) {
      const v = json[key];
      if (typeof v === 'string' && isUsableDisplayName(v, phoneHint)) {
        return v.trim();
      }
    }
    return null;
  };

  for (const contactId of contactIds) {
    try {
      const res = await wahaFetch(
        opts,
        `/api/contacts?contactId=${encodeURIComponent(contactId)}&session=${encodeURIComponent(session)}`,
      );
      if (res.ok) {
        const picked = pickName((await res.json()) as Record<string, unknown>);
        if (picked) return picked;
      }
    } catch (err) {
      console.warn('[waha] contact name lookup failed:', err);
    }
  }

  // Chat overview is the most reliable place for display names.
  try {
    const chatId = contactIds.find((id) => id.includes('@')) || `${digits}@c.us`;
    const res = await wahaFetch(
      opts,
      `/api/${encodeURIComponent(session)}/chats/overview?limit=1&ids=${encodeURIComponent(chatId)}&ids=${encodeURIComponent(digits)}`,
    );
    if (res.ok) {
      const list = (await res.json()) as unknown;
      if (Array.isArray(list)) {
        for (const row of list) {
          if (!row || typeof row !== 'object') continue;
          const name = (row as { name?: unknown }).name;
          if (typeof name === 'string' && isUsableDisplayName(name, phoneHint)) {
            return name.trim();
          }
        }
      }
    }
  } catch (err) {
    console.warn('[waha] chats overview name lookup failed:', err);
  }

  // Chat metadata sometimes has the display name when Contacts API is empty.
  for (const chatId of contactIds.filter((id) => id.includes('@'))) {
    try {
      const res = await wahaFetch(
        opts,
        `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const nested =
        json.chat && typeof json.chat === 'object'
          ? (json.chat as Record<string, unknown>)
          : json;
      const picked = pickName(nested);
      if (picked) return picked;
    } catch (err) {
      console.warn('[waha] chat name lookup failed:', err);
    }
  }

  return null;
}

function pushCandidate(list: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) list.push(value.trim());
}

function isGroupOrStatusJid(jid: string): boolean {
  return (
    jid.endsWith('@g.us') ||
    jid.endsWith('@newsletter') ||
    jid === 'status@broadcast'
  );
}

function remoteJidFromPayload(payload: Record<string, unknown>): string | null {
  const fromKey = (key: unknown): string | null => {
    if (!key || typeof key !== 'object') return null;
    const jid = (key as Record<string, unknown>).remoteJid;
    return typeof jid === 'string' && jid.trim() ? jid.trim() : null;
  };
  const top = fromKey(payload.key);
  if (top) return top;
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  return fromKey(data?.key);
}

function infoChatFromPayload(payload: Record<string, unknown>): string | null {
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  const info =
    data?.Info && typeof data.Info === 'object'
      ? (data.Info as Record<string, unknown>)
      : null;
  return typeof info?.Chat === 'string' && info.Chat.trim() ? info.Chat.trim() : null;
}

/**
 * Chat JID for an outbound (fromMe) echo. WEBJS puts our number in `to`
 * and the contact in `chatId`/`from`; GOWS often puts us in `from` and
 * the contact in `to`/`key.remoteJid`. Prefer the chat, never our own JID.
 */
export function pickOutboundChatJid(
  payload: Record<string, unknown>,
  meId?: string | null,
): string | null {
  const to = typeof payload.to === 'string' ? payload.to : null;
  const chatId = typeof payload.chatId === 'string' ? payload.chatId : null;
  const from = typeof payload.from === 'string' ? payload.from : null;
  const ranked = [
    remoteJidFromSerializedPayload(payload),
    chatId,
    infoChatFromPayload(payload),
    remoteJidFromPayload(payload),
    from,
    to,
  ];
  const usable = ranked.filter(
    (jid): jid is string => Boolean(jid) && !isGroupOrStatusJid(jid as string),
  );
  const notMe = usable.find((jid) => !isSessionMeJid(jid, meId));
  return notMe ?? usable[0] ?? null;
}

/**
 * Prefer real @c.us from webhook payload fields; fall back to LID resolve API.
 * For outbound echoes (`fromMe`), GOWS often puts the session's own JID in
 * `from` and the contact in `to` / `chatId` — those must win or the echo
 * lands on the wrong conversation (or is dropped).
 */
export async function resolveInboundChatId(
  opts: WahaClientOptions,
  payload: Record<string, unknown>,
  options?: { fromMe?: boolean; meId?: string | null },
): Promise<{ chatId: string; phone: string } | null> {
  const rawFrom =
    typeof payload.from === 'string'
      ? payload.from
      : typeof payload.chatId === 'string'
        ? payload.chatId
        : null;
  const to = typeof payload.to === 'string' ? payload.to : null;
  const chatIdField =
    typeof payload.chatId === 'string' ? payload.chatId : null;
  const meId = options?.meId ?? null;

  const serializedRemote = remoteJidFromSerializedPayload(payload);
  const from = options?.fromMe
    ? pickOutboundChatJid(payload, meId)
    : rawFrom || serializedRemote;

  if (!from) return null;
  if (wahaPayloadIsGroup(payload) || isGroupOrStatusJid(from)) {
    return null;
  }

  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;

  const candidates: string[] = [];
  // Picked chat jid first — for fromMe, `to` is often OUR number (WEBJS)
  // and must not win the loop.
  pushCandidate(candidates, from);
  if (chatIdField) pushCandidate(candidates, chatIdField);
  if (options?.fromMe) {
    pushCandidate(candidates, infoChatFromPayload(payload));
    pushCandidate(candidates, remoteJidFromPayload(payload));
    if (to && !isSessionMeJid(to, meId)) pushCandidate(candidates, to);
  }

  // WEBJS / NOWEB / GOWS alternate PN fields seen in the wild.
  if (data) {
    const key =
      data.key && typeof data.key === 'object'
        ? (data.key as Record<string, unknown>)
        : null;
    pushCandidate(candidates, key?.senderPn);
    pushCandidate(candidates, key?.participantPn);
    pushCandidate(candidates, key?.remoteJidAlt);
    pushCandidate(candidates, data.from);
    pushCandidate(candidates, data.author);
    pushCandidate(candidates, data.participant);
    pushCandidate(candidates, data.sender);
    pushCandidate(candidates, data.notifyName); // not a phone — filtered below

    const info =
      data.Info && typeof data.Info === 'object'
        ? (data.Info as Record<string, unknown>)
        : null;
    pushCandidate(candidates, info?.SenderAlt);
    pushCandidate(candidates, info?.Chat);
    pushCandidate(candidates, info?.Sender);

    const id =
      data.id && typeof data.id === 'object'
        ? (data.id as Record<string, unknown>)
        : null;
    pushCandidate(candidates, id?.remote);
    pushCandidate(candidates, id?.participant);
  }

  pushCandidate(candidates, payload.participant);
  pushCandidate(candidates, payload.from);

  for (const c of candidates) {
    // Skip display names mistakenly collected.
    if (!/[0-9]/.test(c) && !c.includes('@')) continue;
    if (c.endsWith('@lid')) continue;
    if (options?.fromMe && isSessionMeJid(c, meId)) continue;
    if (c.endsWith('@c.us') || (!c.includes('@') && /^\d{8,15}$/.test(c.replace(/\D/g, '')))) {
      const digits = c.replace(/\D/g, '');
      // Reject likely LIDs (very long numeric ids without @c.us).
      if (!c.endsWith('@c.us') && digits.length > 15) continue;
      if (digits.length < 8) continue;
      const chatId = c.includes('@') ? c : `${digits}@c.us`;
      const phone = normalizeDigits(chatIdToPhone(chatId));
      if (phone && phone.length >= 8 && phone.length <= 15) {
        return { chatId, phone };
      }
    }
  }

  if (from.endsWith('@lid') || (!from.includes('@') && from.replace(/\D/g, '').length > 15)) {
    const resolved = await resolveLidToPhone(opts, from);
    if (resolved) {
      const phone = normalizeDigits(chatIdToPhone(resolved));
      if (phone && phone.length >= 8 && phone.length <= 15) {
        return { chatId: resolved, phone };
      }
    }
    console.warn('[waha] could not resolve LID to phone:', from);
    return null;
  }

  const phone = normalizeDigits(chatIdToPhone(from));
  if (!phone || phone.length < 8 || phone.length > 15) return null;
  return { chatId: from.includes('@') ? from : `${phone}@c.us`, phone };
}

function normalizeDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Best-effort body extraction across WAHA engines. */
function textFromProtoMessage(msg: Record<string, unknown>): string | null {
  if (typeof msg.conversation === 'string' && msg.conversation.trim()) {
    return msg.conversation;
  }
  const ext =
    msg.extendedTextMessage && typeof msg.extendedTextMessage === 'object'
      ? (msg.extendedTextMessage as { text?: unknown }).text
      : null;
  if (typeof ext === 'string' && ext.trim()) return ext;

  for (const wrap of [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
  ]) {
    const inner = msg[wrap];
    if (!inner || typeof inner !== 'object') continue;
    const nested = (inner as { message?: unknown }).message;
    if (nested && typeof nested === 'object') {
      const text = textFromProtoMessage(nested as Record<string, unknown>);
      if (text) return text;
    }
  }
  return null;
}

export function extractInboundText(payload: Record<string, unknown>): string | null {
  if (typeof payload.body === 'string' && payload.body.trim()) {
    return payload.body;
  }
  if (typeof payload.caption === 'string' && payload.caption.trim()) {
    return payload.caption;
  }
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text;
  }
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  if (!data) return null;
  if (typeof data.body === 'string' && data.body.trim()) return data.body;
  if (typeof data.caption === 'string' && data.caption.trim()) return data.caption;

  for (const key of ['message', 'Message']) {
    const msg = data[key];
    if (msg && typeof msg === 'object') {
      const text = textFromProtoMessage(msg as Record<string, unknown>);
      if (text) return text;
    }
  }
  return null;
}
