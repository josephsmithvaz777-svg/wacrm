// ============================================================
// Shared WAHA media handling — download from the engine and store a
// copy in the `chat-media` bucket. Used both by the webhook
// (waha-inbound) and by the pull-based history sync (waha-sync), which
// must not import the inbound module because that pulls in the flow /
// automation / AI engines.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { downloadWahaMedia, type WahaClientOptions } from '@/lib/whatsapp/waha-api';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import {
  toStoredAdContext,
  type ExtractedAdContext,
  type MessageAdContext,
} from '@/lib/whatsapp/ad-context';

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

export function mimeToContentType(mime: string | null | undefined): string {
  if (!mime) return 'document';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export async function uploadWahaMedia(
  accountId: string,
  opts: WahaClientOptions,
  mediaUrl: string,
  mime: string | null | undefined,
  filename: string | null | undefined,
): Promise<string | null> {
  try {
    const { buffer, contentType } = await downloadWahaMedia(opts, mediaUrl);
    const name =
      filename || `waha-${Date.now()}.${(mime || contentType).split('/')[1] || 'bin'}`;
    const path = buildMediaPath(accountId, name);
    const { error } = await admin()
      .storage.from('chat-media')
      .upload(path, buffer, {
        contentType: mime || contentType,
        upsert: false,
      });
    if (error) {
      console.error('[waha-media] storage upload failed:', error.message);
      return null;
    }
    const { data } = admin().storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl as string;
  } catch (err) {
    console.error('[waha-media] media download failed:', err);
    return null;
  }
}

const AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function isFacebookCdnUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith('.fbcdn.net') ||
      host.endsWith('.fbsbx.com') ||
      host.endsWith('.facebook.com') ||
      host === 'facebook.com' ||
      host.endsWith('.cdninstagram.com') ||
      host.endsWith('.instagram.com') ||
      host === 'instagram.com'
    );
  } catch {
    return false;
  }
}

function decodeThumbnailBase64(raw: string): Buffer | null {
  const cleaned = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  try {
    const buf = Buffer.from(cleaned, 'base64');
    return buf.length > 80 && buf.length <= AD_IMAGE_MAX_BYTES ? buf : null;
  } catch {
    return null;
  }
}

async function uploadChatMediaBytes(
  accountId: string,
  buffer: Buffer,
  mime: string,
  basename: string,
): Promise<string | null> {
  const path = buildMediaPath(accountId, basename);
  const { error } = await admin()
    .storage.from('chat-media')
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (error) {
    console.error('[waha-media] ad image upload failed:', error.message);
    return null;
  }
  const { data } = admin().storage.from('chat-media').getPublicUrl(path);
  return (data.publicUrl as string) || null;
}

/**
 * Copy a Click-to-WhatsApp creative into `chat-media` so the inbox
 * still has the image after Facebook CDN URLs expire. Falls back to
 * the original URL when the copy fails.
 */
export async function persistAdCreative(
  accountId: string,
  extracted: ExtractedAdContext,
  waha?: WahaClientOptions,
): Promise<MessageAdContext> {
  const stored = toStoredAdContext(extracted);
  let imageUrl = stored.image_url;

  if (extracted.thumbnailBase64) {
    const buf = decodeThumbnailBase64(extracted.thumbnailBase64);
    if (buf) {
      const uploaded = await uploadChatMediaBytes(
        accountId,
        buf,
        'image/jpeg',
        'ad-thumb.jpg',
      );
      if (uploaded) imageUrl = uploaded;
    }
  } else if (imageUrl && isFacebookCdnUrl(imageUrl) && (await isDeliverableUrl(imageUrl))) {
    try {
      const res = await fetch(imageUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'image/*' },
        redirect: 'follow',
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const mimeRaw = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
        const mime = mimeRaw.startsWith('image/') ? mimeRaw : 'image/jpeg';
        if (buf.length > 80 && buf.length <= AD_IMAGE_MAX_BYTES) {
          const uploaded = await uploadChatMediaBytes(
            accountId,
            buf,
            mime,
            'ad-creative.jpg',
          );
          if (uploaded) imageUrl = uploaded;
        }
      }
    } catch (err) {
      console.warn('[waha-media] ad creative fetch failed:', err);
    }
  } else if (imageUrl && waha) {
    const uploaded = await uploadWahaMedia(
      accountId,
      waha,
      imageUrl,
      'image/jpeg',
      'ad-thumb.jpg',
    );
    if (uploaded) imageUrl = uploaded;
  }

  return { ...stored, image_url: imageUrl };
}

/** Persist the creative; keep the extracted card if the copy fails. */
export async function persistAdCreativeSafe(
  accountId: string,
  extracted: ExtractedAdContext,
  waha?: WahaClientOptions,
): Promise<MessageAdContext> {
  try {
    return await persistAdCreative(accountId, extracted, waha);
  } catch (err) {
    console.warn('[waha-media] persistAdCreative failed:', err);
    return toStoredAdContext(extracted);
  }
}

/** `media` object as WAHA sends it on message payloads. */
export interface WahaMediaRef {
  url?: string;
  mimetype?: string;
  filename?: string | null;
}

export function readMediaRef(payload: Record<string, unknown>): WahaMediaRef | null {
  const media = payload.media;
  if (!media || typeof media !== 'object') return null;
  return media as WahaMediaRef;
}
