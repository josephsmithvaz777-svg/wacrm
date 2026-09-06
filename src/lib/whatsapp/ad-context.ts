// ============================================================
// Click-to-WhatsApp ad context.
//
// Facebook / Instagram ads that open a WhatsApp chat send a creative
// (image, headline, caption, source URL) alongside the customer's
// first message. Meta puts it on `message.referral`. WAHA engines
// nest it as `contextInfo.externalAdReply` (WEBJS) or the protobuf
// equivalent (GOWS / NOWEB). This module normalises both into the
// shape stored on `messages.ad_context`.
// ============================================================

export interface MessageAdContext {
  source: 'facebook_ad' | 'instagram_ad' | 'ad';
  headline: string | null;
  body: string | null;
  image_url: string | null;
  source_url: string | null;
}

export interface ExtractedAdContext extends MessageAdContext {
  /** JPEG thumbnail from the engine; never persisted — uploaded then dropped. */
  thumbnailBase64?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pick(
  obj: Record<string, unknown>,
  names: string[],
): unknown {
  const lower = new Map<string, unknown>();
  for (const [key, val] of Object.entries(obj)) {
    lower.set(key.toLowerCase(), val);
  }
  for (const name of names) {
    if (lower.has(name.toLowerCase())) return lower.get(name.toLowerCase());
  }
  return undefined;
}

function pickString(
  obj: Record<string, unknown>,
  names: string[],
): string | null {
  const raw = pick(obj, names);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * Catalog / Advantage+ ads often arrive with unresolved Mustache
 * tokens (`{{product.name}}`) instead of the real headline. WhatsApp
 * fills those on the phone; the webhook still has the template. Treat
 * them as missing copy so the inbox does not show the raw `{{…}}`.
 */
export function sanitizeAdCopy(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('{{')) return trimmed;
  const withoutTokens = trimmed.replace(/\{\{\s*[\w.]+\s*\}\}/g, '').trim();
  return withoutTokens || null;
}

function looksLikeAdReply(obj: Record<string, unknown>): boolean {
  const sourceUrl = pickString(obj, ['sourceUrl', 'source_url']);
  const sourceType = pick(obj, ['sourceType', 'source_type']);
  const showAd = pick(obj, ['showAdAttribution', 'show_ad_attribution']);
  if (showAd === true || showAd === 1 || showAd === 'true') return true;
  if (typeof sourceType === 'string' && /ad|post/i.test(sourceType)) return true;
  if (typeof sourceType === 'number' && sourceType > 0) return true;
  if (sourceUrl && /facebook\.com|fb\.me|instagram\.com|fbcdn|fbsbx/i.test(sourceUrl)) {
    return true;
  }
  // WEBJS always sends title+thumbnailUrl on CTWA even without a URL.
  const title = pickString(obj, ['title', 'headline']);
  const thumb = pickString(obj, [
    'thumbnailUrl',
    'thumbnail_url',
    'originalImageUrl',
    'original_image_url',
  ]);
  return Boolean(title && thumb);
}

function bytesToBase64(bytes: number[] | Uint8Array): string | null {
  if (bytes.length < 80 || bytes.length > 5 * 1024 * 1024) return null;
  const B = (
    globalThis as {
      Buffer?: { from: (d: number[] | Uint8Array) => { toString: (e: string) => string } };
    }
  ).Buffer;
  if (!B) return null;
  return B.from(bytes).toString('base64');
}

/**
 * WAHA/WEBJS serialises `jpegThumbnail` as a Node Buffer JSON
 * (`{ type: "Buffer", data: [255, 216, …] }`) more often than as
 * a base64 string — catalog ads in particular omit `thumbnailUrl`
 * and only send those bytes.
 */
function readThumbnailBase64(obj: Record<string, unknown>): string | null {
  const raw = pick(obj, [
    'jpegThumbnail',
    'JPEGThumbnail',
    'thumbnail',
    'Thumbnail',
    'jpeg_thumbnail',
  ]);
  if (typeof raw === 'string' && raw.length > 80) return raw;
  if (Array.isArray(raw) && raw.every((n) => typeof n === 'number')) {
    return bytesToBase64(raw as number[]);
  }
  const rec = asRecord(raw);
  if (!rec) return null;
  if (Array.isArray(rec.data) && rec.data.every((n) => typeof n === 'number')) {
    return bytesToBase64(rec.data as number[]);
  }
  const nested = pickString(rec, ['data', 'bytes']);
  if (nested && nested.length > 80) return nested;
  return null;
}

function fromAdReply(obj: Record<string, unknown>): ExtractedAdContext | null {
  if (!looksLikeAdReply(obj)) return null;
  const sourceUrl = pickString(obj, ['sourceUrl', 'source_url']);
  const imageUrl =
    pickString(obj, [
      'thumbnailUrl',
      'thumbnail_url',
      'originalImageUrl',
      'original_image_url',
      'mediaUrl',
      'media_url',
      'imageUrl',
      'image_url',
    ]) || null;
  const headline = sanitizeAdCopy(pickString(obj, ['title', 'headline']));
  const body = sanitizeAdCopy(
    pickString(obj, ['body', 'caption', 'description']),
  );
  const thumbnailBase64 = readThumbnailBase64(obj);
  if (!headline && !body && !imageUrl && !sourceUrl && !thumbnailBase64) {
    return null;
  }

  let source: MessageAdContext['source'] = 'facebook_ad';
  const blob = `${sourceUrl ?? ''} ${headline ?? ''}`.toLowerCase();
  if (blob.includes('instagram')) source = 'instagram_ad';
  else if (sourceUrl && !/facebook|fb\.me|fbcdn/.test(blob)) source = 'ad';

  return {
    source,
    headline,
    body,
    image_url: imageUrl,
    source_url: sourceUrl,
    thumbnailBase64,
  };
}

function mergeAdContext(
  a: ExtractedAdContext | null,
  b: ExtractedAdContext | null,
): ExtractedAdContext | null {
  if (!a) return b;
  if (!b) return a;
  return {
    source: a.source !== 'ad' ? a.source : b.source,
    headline: a.headline || b.headline,
    body: a.body || b.body,
    image_url: a.image_url || b.image_url,
    source_url: a.source_url || b.source_url,
    thumbnailBase64: a.thumbnailBase64 || b.thumbnailBase64,
  };
}

function adCardComplete(ctx: ExtractedAdContext | null): boolean {
  if (!ctx) return false;
  return Boolean(
    (ctx.headline || ctx.body) &&
      (ctx.image_url || ctx.thumbnailBase64),
  );
}

function fromProductNode(obj: Record<string, unknown>): ExtractedAdContext | null {
  const product = asRecord(pick(obj, ['product', 'Product'])) || obj;
  const headline = sanitizeAdCopy(
    pickString(product, ['title', 'productTitle', 'product_title']),
  );
  const body = sanitizeAdCopy(
    pickString(product, ['description', 'productDescription', 'product_description']),
  );
  const image =
    asRecord(pick(product, ['productImage', 'image', 'product_image'])) ||
    product;
  const imageUrl = pickString(image, [
    'url',
    'imageUrl',
    'image_url',
    'thumbnailUrl',
    'thumbnail_url',
  ]);
  const thumbnailBase64 =
    readThumbnailBase64(image) || readThumbnailBase64(product);
  if (!headline && !body && !imageUrl && !thumbnailBase64) return null;
  return {
    source: 'facebook_ad',
    headline,
    body,
    image_url: imageUrl,
    source_url: null,
    thumbnailBase64,
  };
}

/**
 * Walk WAHA / protobuf-shaped payloads looking for externalAdReply.
 * Bounded so a cyclic or huge payload cannot hang the webhook.
 */
export function extractAdContext(
  payload: Record<string, unknown> | null | undefined,
): ExtractedAdContext | null {
  if (!payload) return null;
  let found: ExtractedAdContext | null = null;
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number) => {
    if (adCardComplete(found) || depth > 10 || !node) return;
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 8)) visit(item, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    const nestedAd = pick(rec, [
      'externalAdReply',
      'ExternalAdReply',
      'external_ad_reply',
      'hydratedAdReply',
    ]);
    if (asRecord(nestedAd)) {
      found = mergeAdContext(found, fromAdReply(asRecord(nestedAd)!));
      if (adCardComplete(found)) return;
    }
    const productMsg = pick(rec, [
      'productMessage',
      'ProductMessage',
      'product_message',
    ]);
    if (asRecord(productMsg)) {
      found = mergeAdContext(found, fromProductNode(asRecord(productMsg)!));
      if (adCardComplete(found)) return;
    }
    found = mergeAdContext(found, fromAdReply(rec));
    if (adCardComplete(found)) return;
    for (const [key, child] of Object.entries(rec)) {
      if (/ad|context|^message$|_data|extended|quoted|product|media|thumb|image/i.test(key)) {
        visit(child, depth + 1);
        if (adCardComplete(found)) return;
      }
    }
  };
  visit(payload, 0);

  if (found && !found.image_url && !found.thumbnailBase64) {
    const media = asRecord(payload.media);
    const mediaUrl = media ? pickString(media, ['url', 'link', 'href']) : null;
    if (mediaUrl) found = { ...found, image_url: mediaUrl };
  }
  return found;
}

/** Meta Cloud API `messages[].referral` on Click-to-WhatsApp ads. */
export function extractMetaReferral(
  message: Record<string, unknown> | null | undefined,
): ExtractedAdContext | null {
  if (!message) return null;
  const referral = asRecord(message.referral);
  if (!referral) return null;
  const sourceType = pickString(referral, ['source_type', 'sourceType']);
  const sourceUrl = pickString(referral, ['source_url', 'sourceUrl']);
  const headline = sanitizeAdCopy(pickString(referral, ['headline', 'title']));
  const body = sanitizeAdCopy(pickString(referral, ['body', 'description']));
  const mediaType = pickString(referral, ['media_type']);
  const imageUrl =
    (mediaType && /video/i.test(mediaType)
      ? pickString(referral, ['thumbnail_url', 'image_url'])
      : pickString(referral, ['image_url', 'thumbnail_url'])) || null;
  if (!headline && !body && !imageUrl && !sourceUrl) return null;
  let source: MessageAdContext['source'] = 'facebook_ad';
  if (sourceType && /instagram/i.test(sourceType)) source = 'instagram_ad';
  else if (sourceType && !/ad/i.test(sourceType) && sourceType !== 'ad') {
    source = 'ad';
  }
  return {
    source,
    headline,
    body,
    image_url: imageUrl,
    source_url: sourceUrl,
  };
}

export function toStoredAdContext(
  extracted: ExtractedAdContext,
): MessageAdContext {
  return {
    source: extracted.source,
    headline: extracted.headline,
    body: extracted.body,
    image_url: extracted.image_url,
    source_url: extracted.source_url,
  };
}

export function readStoredAdContext(value: unknown): MessageAdContext | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const sourceRaw = rec.source;
  const source: MessageAdContext['source'] =
    sourceRaw === 'instagram_ad' || sourceRaw === 'ad' || sourceRaw === 'facebook_ad'
      ? sourceRaw
      : 'facebook_ad';
  const headline = sanitizeAdCopy(
    typeof rec.headline === 'string' ? rec.headline : null,
  );
  const body = sanitizeAdCopy(typeof rec.body === 'string' ? rec.body : null);
  const image_url = typeof rec.image_url === 'string' ? rec.image_url : null;
  const source_url = typeof rec.source_url === 'string' ? rec.source_url : null;
  if (!headline && !body && !image_url && !source_url) return null;
  return { source, headline, body, image_url, source_url };
}
