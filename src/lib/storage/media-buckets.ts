import { hasMinRole, type AccountRole } from '@/lib/auth/roles';
import { buildMediaPath, isAccountMediaPath } from '@/lib/storage/upload-media';
import { isNotificationSoundFile } from '@/lib/sounds';

/**
 * Buckets the CRM is allowed to write on the VPS media volume.
 * Mirrors the Supabase Storage buckets the app used before uploads
 * moved to disk (migrations 008, 016, 023, 039, 051).
 */
export const MEDIA_BUCKETS = [
  'chat-media',
  'flow-media',
  'avatars',
  'account-logos',
  'account-sounds',
] as const;

export type MediaBucket = (typeof MEDIA_BUCKETS)[number];

/** 16 MB — chat-media and flow-media (migrations 016/023). */
const MEDIA_16_MB = 16 * 1024 * 1024;
/** 2 MB — avatars, logos, notification sounds. */
const MEDIA_2_MB = 2 * 1024 * 1024;

const CHAT_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/ogg',
  'audio/mpeg',
  'audio/aac',
  'audio/mp4',
  'audio/amr',
] as const;

const FLOW_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/3gpp',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

const AVATAR_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

const LOGO_MIME = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export class MediaStorageError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'MediaStorageError';
    this.status = status;
  }
}

export function isMediaBucket(value: string): value is MediaBucket {
  return (MEDIA_BUCKETS as readonly string[]).includes(value);
}

export function mediaMaxBytes(bucket: MediaBucket): number {
  if (bucket === 'chat-media' || bucket === 'flow-media') return MEDIA_16_MB;
  return MEDIA_2_MB;
}

/**
 * Logos and sounds were admin-only in Storage RLS. Chat, flow, and
 * avatars are any signed-in member (avatars are further scoped to the
 * caller's own user id).
 */
export function bucketMinRole(bucket: MediaBucket): AccountRole | null {
  if (bucket === 'account-logos' || bucket === 'account-sounds') return 'admin';
  return null;
}

export function assertBucketRole(bucket: MediaBucket, role: AccountRole): void {
  const min = bucketMinRole(bucket);
  if (min && !hasMinRole(role, min)) {
    throw new MediaStorageError(
      `This action requires the '${min}' role or higher`,
      403
    );
  }
}

/** Relative object path: no absolute, no traversal, no empty segments. */
export function isSafeRelativePath(objectPath: string): boolean {
  if (!objectPath || objectPath.length > 512) return false;
  if (
    objectPath.startsWith('/') ||
    objectPath.includes('\\') ||
    objectPath.includes('\0')
  ) {
    return false;
  }
  const parts = objectPath.split('/');
  return parts.every(
    (part) => part.length > 0 && part !== '.' && part !== '..'
  );
}

function assertPathSegment(id: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new MediaStorageError(`Invalid ${label}.`, 400);
  }
}

function safeExt(raw: string, fallback: string): string {
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ext.length >= 1 && ext.length <= 8) return ext;
  return fallback;
}

/** `{userId}/avatar-<ts>.<ext>` — same shape profile-form used in Storage. */
export function buildAvatarObjectPath(
  userId: string,
  fileName: string,
  mime: string,
  now: number = Date.now()
): string {
  assertPathSegment(userId, 'user id');
  const fromName = fileName.split('.').pop() ?? '';
  const hasDot = fileName.includes('.');
  const ext = hasDot
    ? safeExt(fromName, extensionForAvatarMime(mime))
    : extensionForAvatarMime(mime);
  return `${userId}/avatar-${now}.${ext}`;
}

function extensionForAvatarMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

/** `{accountId}/logo-<ts>.<ext>` — svg when the type is image/svg+xml. */
export function buildAccountLogoObjectPath(
  accountId: string,
  mime: string,
  now: number = Date.now()
): string {
  assertPathSegment(accountId, 'account id');
  const ext =
    mime === 'image/svg+xml' ? 'svg' : safeExt(mime.split('/')[1] ?? '', 'png');
  return `${accountId}/logo-${now}.${ext}`;
}

const SOUND_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm']);

/** `{accountId}/notify-<ts>.<ext>` — extension from the original filename. */
export function buildAccountSoundObjectPath(
  accountId: string,
  fileName: string,
  now: number = Date.now()
): string {
  assertPathSegment(accountId, 'account id');
  const fromName = fileName.includes('.')
    ? (fileName.split('.').pop() ?? '').toLowerCase()
    : '';
  const ext = SOUND_EXTS.has(fromName) ? fromName : 'mp3';
  return `${accountId}/notify-${now}.${ext}`;
}

export function buildUploadObjectPath(args: {
  bucket: MediaBucket;
  accountId: string;
  userId: string;
  fileName: string;
  mime: string;
  now?: number;
}): string {
  const now = args.now ?? Date.now();
  switch (args.bucket) {
    case 'chat-media':
    case 'flow-media':
      assertPathSegment(args.accountId, 'account id');
      return buildMediaPath(args.accountId, args.fileName, now);
    case 'avatars':
      return buildAvatarObjectPath(args.userId, args.fileName, args.mime, now);
    case 'account-logos':
      return buildAccountLogoObjectPath(args.accountId, args.mime, now);
    case 'account-sounds':
      return buildAccountSoundObjectPath(args.accountId, args.fileName, now);
  }
}

export function validateMediaFile(
  bucket: MediaBucket,
  file: { name: string; type: string; size: number }
): void {
  const max = mediaMaxBytes(bucket);
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new MediaStorageError('File is empty.', 400);
  }
  if (file.size > max) {
    throw new MediaStorageError('File is too large.', 400);
  }

  const mime = file.type.trim().toLowerCase();
  if (bucket === 'account-sounds') {
    if (
      !isNotificationSoundFile({ name: file.name, type: mime, size: file.size })
    ) {
      throw new MediaStorageError('Unsupported file type.', 400);
    }
    return;
  }

  const allowed = allowedMimes(bucket);
  if (!allowed.has(mime)) {
    throw new MediaStorageError('Unsupported file type.', 400);
  }
}

function allowedMimes(
  bucket: Exclude<MediaBucket, 'account-sounds'>
): Set<string> {
  switch (bucket) {
    case 'chat-media':
      return new Set(CHAT_MIME);
    case 'flow-media':
      return new Set(FLOW_MIME);
    case 'avatars':
      return new Set(AVATAR_MIME);
    case 'account-logos':
      return new Set(LOGO_MIME);
  }
}

/** True when this caller may read or delete `objectPath`. */
export function isOwnedMediaPath(
  bucket: MediaBucket,
  objectPath: string,
  accountId: string,
  userId: string
): boolean {
  if (!isSafeRelativePath(objectPath)) return false;
  if (bucket === 'avatars') {
    return isDirectChild(`${userId}/`, objectPath);
  }
  if (bucket === 'account-logos' || bucket === 'account-sounds') {
    return isDirectChild(`${accountId}/`, objectPath);
  }
  return isAccountMediaPath(accountId, objectPath);
}

function isDirectChild(prefix: string, objectPath: string): boolean {
  if (!objectPath.startsWith(prefix)) return false;
  const rest = objectPath.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Folder listing is one level, and only the caller's own folder.
 * Notification sounds list `{accountId}` before replacing the file.
 */
export function isOwnedListPrefix(
  bucket: MediaBucket,
  prefix: string,
  accountId: string,
  userId: string
): boolean {
  if (!prefix || prefix.includes('/') || !isSafeRelativePath(prefix))
    return false;
  if (bucket === 'avatars') return prefix === userId;
  if (bucket === 'account-logos' || bucket === 'account-sounds')
    return prefix === accountId;
  return prefix === `account-${accountId}`;
}
