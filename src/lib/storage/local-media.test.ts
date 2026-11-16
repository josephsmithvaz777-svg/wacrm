import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteLocalMedia,
  formatPublicMediaUrl,
  listLocalMedia,
  requireMediaConfig,
  writeLocalMedia,
} from './local-media';
import {
  buildAccountLogoObjectPath,
  buildAccountSoundObjectPath,
  buildAvatarObjectPath,
  buildUploadObjectPath,
  isOwnedMediaPath,
  validateMediaFile,
} from './media-buckets';

const ACCOUNT = '11111111-2222-3333-4444-555555555555';
const USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const BASE = 'https://media.joshuavazquez.com/crm';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wacrm-media-'));
  process.env.MEDIA_LOCAL_DIR = dir;
  process.env.MEDIA_PUBLIC_BASE_URL = `${BASE}/`;
});

afterEach(async () => {
  delete process.env.MEDIA_LOCAL_DIR;
  delete process.env.MEDIA_PUBLIC_BASE_URL;
  await rm(dir, { recursive: true, force: true });
});

describe('requireMediaConfig', () => {
  it('fails explicitly when either variable is missing', () => {
    delete process.env.MEDIA_LOCAL_DIR;
    expect(() => requireMediaConfig()).toThrow(/MEDIA_LOCAL_DIR/);

    process.env.MEDIA_LOCAL_DIR = dir;
    delete process.env.MEDIA_PUBLIC_BASE_URL;
    expect(() => requireMediaConfig()).toThrow(/MEDIA_PUBLIC_BASE_URL/);
  });

  it('strips a trailing slash from the public base', () => {
    expect(requireMediaConfig().baseUrl).toBe(BASE);
  });
});

describe('formatPublicMediaUrl', () => {
  it('joins base, bucket, and path', () => {
    const objectPath = `account-${ACCOUNT}/1700000000000-photo.png`;
    expect(formatPublicMediaUrl(BASE, 'chat-media', objectPath)).toBe(
      `${BASE}/chat-media/${objectPath}`
    );
  });

  it('encodes each path segment', () => {
    expect(
      formatPublicMediaUrl(BASE, 'chat-media', 'account-a/my file.png')
    ).toBe(`${BASE}/chat-media/account-a/my%20file.png`);
  });
});

describe('object paths', () => {
  it('keeps chat and flow objects under account-<id>', () => {
    const chat = buildUploadObjectPath({
      bucket: 'chat-media',
      accountId: ACCOUNT,
      userId: USER,
      fileName: 'photo.png',
      mime: 'image/png',
      now: 1700000000000,
    });
    expect(chat).toBe(`account-${ACCOUNT}/1700000000000-photo.png`);

    const flow = buildUploadObjectPath({
      bucket: 'flow-media',
      accountId: ACCOUNT,
      userId: USER,
      fileName: 'invoice.PDF',
      mime: 'application/pdf',
      now: 1700000000000,
    });
    expect(flow).toBe(`account-${ACCOUNT}/1700000000000-invoice.pdf`);
  });

  it('keeps avatar, logo, and sound paths in their current shapes', () => {
    expect(
      buildAvatarObjectPath(USER, 'photo.PNG', 'image/png', 1700000000000)
    ).toBe(`${USER}/avatar-1700000000000.png`);
    expect(
      buildAccountLogoObjectPath(ACCOUNT, 'image/svg+xml', 1700000000000)
    ).toBe(`${ACCOUNT}/logo-1700000000000.svg`);
    expect(
      buildAccountLogoObjectPath(ACCOUNT, 'image/jpeg', 1700000000000)
    ).toBe(`${ACCOUNT}/logo-1700000000000.jpeg`);
    expect(
      buildAccountSoundObjectPath(ACCOUNT, 'chime.MP3', 1700000000000)
    ).toBe(`${ACCOUNT}/notify-1700000000000.mp3`);
  });
});

describe('validateMediaFile', () => {
  it('accepts a chat image and rejects a type the bucket did not allow', () => {
    expect(() =>
      validateMediaFile('chat-media', {
        name: 'a.png',
        type: 'image/png',
        size: 1024,
      })
    ).not.toThrow();
    expect(() =>
      validateMediaFile('flow-media', {
        name: 'a.ogg',
        type: 'audio/ogg',
        size: 1024,
      })
    ).toThrow(/Unsupported file type/);
  });

  it('rejects an empty file and a file over the bucket ceiling', () => {
    expect(() =>
      validateMediaFile('avatars', {
        name: 'a.png',
        type: 'image/png',
        size: 0,
      })
    ).toThrow(/empty/i);
    expect(() =>
      validateMediaFile('avatars', {
        name: 'a.png',
        type: 'image/png',
        size: 2 * 1024 * 1024 + 1,
      })
    ).toThrow(/too large/i);
  });
});

describe('isOwnedMediaPath', () => {
  it("only allows the caller's own folder", () => {
    expect(
      isOwnedMediaPath(
        'chat-media',
        `account-${ACCOUNT}/170-photo.png`,
        ACCOUNT,
        USER
      )
    ).toBe(true);
    expect(
      isOwnedMediaPath(
        'chat-media',
        'account-other/170-photo.png',
        ACCOUNT,
        USER
      )
    ).toBe(false);
    expect(
      isOwnedMediaPath('avatars', `${USER}/avatar-1.png`, ACCOUNT, USER)
    ).toBe(true);
    expect(
      isOwnedMediaPath('avatars', 'someone-else/avatar-1.png', ACCOUNT, USER)
    ).toBe(false);
    expect(
      isOwnedMediaPath('account-sounds', '../secret.mp3', ACCOUNT, USER)
    ).toBe(false);
  });
});

describe('writeLocalMedia', () => {
  it('creates folders, writes the bytes, and returns the public URL', async () => {
    const objectPath = `account-${ACCOUNT}/1700000000000-photo.png`;
    const saved = await writeLocalMedia(
      'chat-media',
      objectPath,
      Buffer.from('png-bytes')
    );

    expect(saved).toEqual({
      publicUrl: `${BASE}/chat-media/${objectPath}`,
      path: objectPath,
    });
    const full = path.join(dir, 'chat-media', objectPath);
    expect(await readFile(full, 'utf8')).toBe('png-bytes');
    if (process.platform !== 'win32') {
      const info = await stat(full);
      expect(info.mode & 0o777).toBe(0o644);
    }
  });

  it('refuses a path that escapes the bucket', async () => {
    await expect(
      writeLocalMedia('chat-media', '../secret.txt', Buffer.from('nope'))
    ).rejects.toThrow(/Invalid media path/);
  });

  it('lists and deletes a file in a folder', async () => {
    const objectPath = `${ACCOUNT}/notify-1.mp3`;
    await writeLocalMedia('account-sounds', objectPath, Buffer.from('mp3'));
    expect(await listLocalMedia('account-sounds', ACCOUNT)).toEqual([
      objectPath,
    ]);

    await deleteLocalMedia('account-sounds', objectPath);
    expect(await listLocalMedia('account-sounds', ACCOUNT)).toEqual([]);
    await deleteLocalMedia('account-sounds', objectPath);
  });
});
