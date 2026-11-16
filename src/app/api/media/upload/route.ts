import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
  UnauthorizedError,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  deleteLocalMedia,
  listLocalMedia,
  writeLocalMedia,
} from '@/lib/storage/local-media';
import {
  assertBucketRole,
  buildUploadObjectPath,
  isMediaBucket,
  isOwnedListPrefix,
  isOwnedMediaPath,
  MediaStorageError,
  validateMediaFile,
} from '@/lib/storage/media-buckets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mediaErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (err instanceof MediaStorageError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return toErrorResponse(err);
}

async function authorizedContext() {
  const ctx = await getCurrentAccount();
  const limit = checkRateLimit(`media:${ctx.userId}`, RATE_LIMITS.mediaUpload);
  if (!limit.success) return { ctx, limited: rateLimitResponse(limit) };
  return { ctx, limited: null };
}

/**
 * POST /api/media/upload
 * multipart: `bucket`, `file`
 * Writes under MEDIA_LOCAL_DIR and returns `{ publicUrl, path }`.
 */
export async function POST(request: Request) {
  try {
    const { ctx, limited } = await authorizedContext();
    if (limited) return limited;

    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json(
        { error: 'Expected a multipart upload.' },
        { status: 400 }
      );
    }
    const bucketRaw = form.get('bucket');
    const file = form.get('file');
    if (typeof bucketRaw !== 'string' || !isMediaBucket(bucketRaw)) {
      return NextResponse.json({ error: 'Unknown bucket.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file.' }, { status: 400 });
    }

    assertBucketRole(bucketRaw, ctx.role);
    validateMediaFile(bucketRaw, {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    validateMediaFile(bucketRaw, {
      name: file.name,
      type: file.type,
      size: bytes.length,
    });

    const objectPath = buildUploadObjectPath({
      bucket: bucketRaw,
      accountId: ctx.accountId,
      userId: ctx.userId,
      fileName: file.name || 'file',
      mime: file.type,
    });
    const saved = await writeLocalMedia(bucketRaw, objectPath, bytes);
    return NextResponse.json(saved);
  } catch (err) {
    return mediaErrorResponse(err);
  }
}

/**
 * DELETE /api/media/upload
 * JSON: `{ bucket, path }` — same scope as the upload.
 */
export async function DELETE(request: Request) {
  try {
    const { ctx, limited } = await authorizedContext();
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as {
      bucket?: unknown;
      path?: unknown;
    } | null;
    const bucket = typeof body?.bucket === 'string' ? body.bucket : '';
    const objectPath = typeof body?.path === 'string' ? body.path : '';
    if (!isMediaBucket(bucket)) {
      return NextResponse.json({ error: 'Unknown bucket.' }, { status: 400 });
    }
    assertBucketRole(bucket, ctx.role);
    if (!isOwnedMediaPath(bucket, objectPath, ctx.accountId, ctx.userId)) {
      return NextResponse.json(
        { error: 'Invalid media path.' },
        { status: 403 }
      );
    }
    await deleteLocalMedia(bucket, objectPath);
    return NextResponse.json({ success: true });
  } catch (err) {
    return mediaErrorResponse(err);
  }
}

/**
 * GET /api/media/upload?bucket=&prefix=
 * Lists one folder the caller owns. Used to replace a notification sound.
 */
export async function GET(request: Request) {
  try {
    const { ctx, limited } = await authorizedContext();
    if (limited) return limited;

    const url = new URL(request.url);
    const bucket = url.searchParams.get('bucket') ?? '';
    const prefix = url.searchParams.get('prefix') ?? '';
    if (!isMediaBucket(bucket)) {
      return NextResponse.json({ error: 'Unknown bucket.' }, { status: 400 });
    }
    assertBucketRole(bucket, ctx.role);
    if (!isOwnedListPrefix(bucket, prefix, ctx.accountId, ctx.userId)) {
      return NextResponse.json(
        { error: 'Invalid media prefix.' },
        { status: 403 }
      );
    }
    const paths = await listLocalMedia(bucket, prefix);
    return NextResponse.json({ paths });
  } catch (err) {
    return mediaErrorResponse(err);
  }
}
