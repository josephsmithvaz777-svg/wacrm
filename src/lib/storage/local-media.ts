import { constants } from 'node:fs';
import { chmod, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  isMediaBucket,
  isSafeRelativePath,
  MediaStorageError,
  type MediaBucket,
} from '@/lib/storage/media-buckets';

/** New files are world-readable so nginx (a different user) can serve them. */
export const MEDIA_FILE_MODE = 0o644;

export interface LocalMediaWriteResult {
  publicUrl: string;
  path: string;
}

/**
 * `MEDIA_LOCAL_DIR` and `MEDIA_PUBLIC_BASE_URL` are required. Missing
 * either one is a deploy mistake — fail here instead of writing somewhere
 * else or returning a Supabase URL.
 */
export function requireMediaConfig(): { dir: string; baseUrl: string } {
  const dir = process.env.MEDIA_LOCAL_DIR?.trim() ?? '';
  const baseUrl = process.env.MEDIA_PUBLIC_BASE_URL?.trim() ?? '';
  const missing = [
    dir ? null : 'MEDIA_LOCAL_DIR',
    baseUrl ? null : 'MEDIA_PUBLIC_BASE_URL',
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new MediaStorageError(`Missing ${missing.join(' and ')}.`);
  }
  return { dir, baseUrl: baseUrl.replace(/\/+$/, '') };
}

/** `{MEDIA_PUBLIC_BASE_URL}/{bucket}/{path}` */
export function formatPublicMediaUrl(
  baseUrl: string,
  bucket: string,
  objectPath: string
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export function publicMediaUrl(bucket: string, objectPath: string): string {
  const { baseUrl } = requireMediaConfig();
  return formatPublicMediaUrl(baseUrl, bucket, objectPath);
}

function resolveInside(bucket: MediaBucket, objectPath: string): string {
  if (!isSafeRelativePath(objectPath)) {
    throw new MediaStorageError('Invalid media path.', 400);
  }
  const { dir } = requireMediaConfig();
  const root = path.resolve(dir, bucket);
  const full = path.resolve(root, objectPath);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new MediaStorageError('Invalid media path.', 400);
  }
  return full;
}

function assertBucket(bucket: string): MediaBucket {
  if (!isMediaBucket(bucket)) {
    throw new MediaStorageError('Unknown bucket.', 400);
  }
  return bucket;
}

function writeFlags(): number {
  const base = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
  if (process.platform === 'win32') return base;
  return base | constants.O_NOFOLLOW;
}

/**
 * Write `body` to `MEDIA_LOCAL_DIR/{bucket}/{objectPath}` and return the
 * public URL nginx will serve. Creates parent folders. The file mode is
 * forced to 644 after the write so the process umask cannot leave it
 * group- or world-unreadable.
 */
export async function writeLocalMedia(
  bucket: string,
  objectPath: string,
  body: Buffer
): Promise<LocalMediaWriteResult> {
  const safeBucket = assertBucket(bucket);
  const full = resolveInside(safeBucket, objectPath);
  await mkdir(path.dirname(full), { recursive: true });

  const handle = await open(full, writeFlags(), MEDIA_FILE_MODE);
  try {
    await handle.writeFile(body);
    await handle.chmod(MEDIA_FILE_MODE);
  } finally {
    await handle.close();
  }
  // `open` mode is masked by umask; chmod again on the path so 644 sticks.
  await chmod(full, MEDIA_FILE_MODE);

  return {
    publicUrl: publicMediaUrl(safeBucket, objectPath),
    path: objectPath,
  };
}

/** Idempotent: a missing file is already gone. */
export async function deleteLocalMedia(
  bucket: string,
  objectPath: string
): Promise<void> {
  const safeBucket = assertBucket(bucket);
  const full = resolveInside(safeBucket, objectPath);
  try {
    await unlink(full);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw err;
  }
}

/** Immediate children of `{bucket}/{prefix}`. Missing folder → []. */
export async function listLocalMedia(
  bucket: string,
  prefix: string
): Promise<string[]> {
  const safeBucket = assertBucket(bucket);
  if (!isSafeRelativePath(prefix) || prefix.includes('/')) {
    throw new MediaStorageError('Invalid media prefix.', 400);
  }
  const dir = resolveInside(safeBucket, prefix);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${prefix}/${entry.name}`)
    .sort();
}
