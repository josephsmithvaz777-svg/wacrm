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
