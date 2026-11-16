/**
 * Client upload helper. Files are posted to `/api/media/upload`, which
 * writes them on the VPS (`MEDIA_LOCAL_DIR`) and returns a public URL
 * under `MEDIA_PUBLIC_BASE_URL`. Chat and flow objects keep the
 * account-scoped path from migration 020/023:
 *
 *   <bucket>/account-<account_id>/<timestamp>-<basename>.<ext>
 *
 * Avatars, logos, and notification sounds keep their own path shapes;
 * the server builds those. Callers must not hand-roll a chat/flow path.
 */

/** 16 MB — matches the `file_size_limit` on both buckets (migrations 016/020/023). */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Per-kind upload ceilings that mirror Meta's WhatsApp Cloud API caps so
 * a file that the bucket would accept (≤16 MB) but Meta would reject is
 * caught client-side BEFORE upload — otherwise it lands in storage as an
 * orphan and the send fails with a confusing 400. Images are Meta's
 * tightest cap at 5 MB; documents are held at the 16 MB bucket limit
 * (Meta allows 100 MB, but the bucket — and shared-hosting upload UX —
 * caps lower).
 */
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

/**
 * Build the account-scoped object path for an upload. Pure + exported so
 * it can be unit-tested without a Supabase client.
 *
 * - `basename` is stripped of its extension, lower-cased non-safe chars
 *   are collapsed to `_`, and it's capped at 40 chars (falls back to
 *   "file" when empty).
 * - The timestamp + the original name keep collisions between two
 *   concurrent uploads astronomically unlikely.
 */
export function buildMediaPath(
  accountId: string,
  fileName: string,
  now: number = Date.now(),
): string {
  // Only treat the trailing segment as an extension when there's a real
  // one — a bare name like "README" has no extension and falls back to
  // "bin" rather than becoming "readme".
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split(".").pop()!.toLowerCase() : "bin";
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .slice(0, 40) || "file";
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}

/** Folder prefix every chat-media object for this account lives under. */
export function accountMediaPrefix(accountId: string): string {
  return `account-${accountId}/`;
}

/** True when `path` is inside this account's chat-media folder. */
export function isAccountMediaPath(accountId: string, path: string): boolean {
  if (!accountId || !path || path.includes("..") || path.startsWith("/")) {
    return false;
  }
  return path.startsWith(accountMediaPrefix(accountId));
}

export interface UploadAccountMediaResult {
  /** Public URL Meta can fetch at send time. */
  publicUrl: string;
  /** Storage object path (account-scoped). */
  path: string;
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

/**
 * Upload a file and return its public URL. The session cookie
 * authenticates the request; the server resolves `account_id`, checks
 * the bucket allow-list, and writes the bytes to disk.
 *
 * Size validation is still the caller's responsibility when it wants a
 * tighter cap than the bucket (images vs documents); the server enforces
 * the bucket ceiling either way. `MEDIA_MAX_BYTES` is the common case.
 */
export async function uploadAccountMedia(
  bucket: string,
  file: File,
): Promise<UploadAccountMediaResult> {
  const form = new FormData();
  form.append("bucket", bucket);
  form.append("file", file);
  const res = await fetch("/api/media/upload", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Upload failed."));
  }
  const body = (await res.json()) as Partial<UploadAccountMediaResult>;
  if (!body.publicUrl || !body.path) {
    throw new Error("Upload failed.");
  }
  return { publicUrl: body.publicUrl, path: body.path };
}

/**
 * Delete a previously-uploaded object. Used to GC media that was staged
 * (uploaded) but never sent — a cancelled draft or a failed send — so
 * abandoned attachments don't accumulate. The server only removes a path
 * inside the caller's own folder.
 *
 * Best-effort: callers fire-and-forget and swallow errors (a missed
 * delete is a storage nit, not something to surface to the user).
 */
export async function deleteAccountMedia(
  bucket: string,
  path: string,
): Promise<void> {
  const res = await fetch("/api/media/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Delete failed."));
  }
}

/** Names of the files directly inside one folder the caller owns. */
export async function listAccountMedia(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const params = new URLSearchParams({ bucket, prefix });
  const res = await fetch(`/api/media/upload?${params}`);
  if (!res.ok) {
    throw new Error(await readApiError(res, "Could not list media."));
  }
  const body = (await res.json()) as { paths?: unknown };
  if (!Array.isArray(body.paths)) return [];
  return body.paths.filter((item): item is string => typeof item === "string");
}
