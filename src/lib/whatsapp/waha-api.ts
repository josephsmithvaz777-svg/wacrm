// ============================================================
// WAHA (WhatsApp HTTP API) client — MVP transport.
// Docs: https://waha.devlike.pro/
// ============================================================

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

function extractMessageId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return `waha-${Date.now()}`;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.id === 'string') return p.id;
  if (p.key && typeof p.key === 'object') {
    const key = p.key as Record<string, unknown>;
    if (typeof key.id === 'string') return key.id;
  }
  if (typeof p.messageId === 'string') return p.messageId;
  return `waha-${Date.now()}`;
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

export async function ensureSession(
  opts: WahaClientOptions,
  webhookUrl: string,
): Promise<{ name: string; status: WahaSessionStatus }> {
  const session = opts.session || 'default';
  const existing = await getSession(opts);
  const config = {
    webhooks: [
      {
        url: webhookUrl,
        events: ['message', 'message.any', 'message.ack', 'session.status'],
      },
    ],
  };

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

function pushCandidate(list: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) list.push(value.trim());
}

/**
 * Prefer real @c.us from webhook payload fields; fall back to LID resolve API.
 */
export async function resolveInboundChatId(
  opts: WahaClientOptions,
  payload: Record<string, unknown>,
): Promise<{ chatId: string; phone: string } | null> {
  const from =
    typeof payload.from === 'string'
      ? payload.from
      : typeof payload.chatId === 'string'
        ? payload.chatId
        : null;
  if (!from) return null;
  if (from.endsWith('@g.us') || from.endsWith('@newsletter') || from === 'status@broadcast') {
    return null;
  }

  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;

  const candidates: string[] = [];
  if (from.endsWith('@c.us')) candidates.push(from);

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
export function extractInboundText(payload: Record<string, unknown>): string | null {
  if (typeof payload.body === 'string' && payload.body.trim()) {
    return payload.body;
  }
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  if (!data) return null;
  if (typeof data.body === 'string' && data.body.trim()) return data.body;
  if (typeof data.caption === 'string' && data.caption.trim()) return data.caption;
  const msg =
    data.message && typeof data.message === 'object'
      ? (data.message as Record<string, unknown>)
      : null;
  if (msg) {
    const conv =
      msg.conversation && typeof msg.conversation === 'string'
        ? msg.conversation
        : null;
    if (conv?.trim()) return conv;
    const ext =
      msg.extendedTextMessage && typeof msg.extendedTextMessage === 'object'
        ? (msg.extendedTextMessage as { text?: string }).text
        : null;
    if (ext?.trim()) return ext;
  }
  return null;
}
