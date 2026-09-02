import { describe, expect, it } from 'vitest';

import {
  extractAdContext,
  extractMetaReferral,
  readStoredAdContext,
  toStoredAdContext,
} from './ad-context';

describe('extractAdContext', () => {
  it('reads WEBJS contextInfo.externalAdReply', () => {
    const ctx = extractAdContext({
      body: '¡Hola! Quiero más información',
      _data: {
        contextInfo: {
          externalAdReply: {
            title: 'PROMOCIÓN EXCLUSIVA',
            body: 'Escríbenos y asegura tu lote',
            thumbnailUrl: 'https://scontent.xx.fbcdn.net/ad.jpg',
            sourceUrl: 'https://fb.me/7jVXgsv6q',
            showAdAttribution: true,
          },
        },
      },
    });
    expect(ctx).toMatchObject({
      source: 'facebook_ad',
      headline: 'PROMOCIÓN EXCLUSIVA',
      body: 'Escríbenos y asegura tu lote',
      image_url: 'https://scontent.xx.fbcdn.net/ad.jpg',
      source_url: 'https://fb.me/7jVXgsv6q',
    });
  });

  it('reads GOWS protobuf nested extendedTextMessage', () => {
    const ctx = extractAdContext({
      Message: {
        extendedTextMessage: {
          text: '¡Hola! Quiero más información',
          contextInfo: {
            externalAdReply: {
              Title: 'Lotes en Virú',
              Body: 'Promoción limitada',
              ThumbnailUrl: 'https://lookaside.fbsbx.com/ad.png',
              SourceUrl: 'https://www.facebook.com/ads/x',
              ShowAdAttribution: true,
            },
          },
        },
      },
    });
    expect(ctx?.headline).toBe('Lotes en Virú');
    expect(ctx?.source_url).toContain('facebook.com');
  });

  it('returns null when there is no ad card', () => {
    expect(extractAdContext({ body: 'hola' })).toBeNull();
    expect(extractAdContext(null)).toBeNull();
  });
});

describe('extractMetaReferral', () => {
  it('maps Cloud API referral fields', () => {
    const ctx = extractMetaReferral({
      type: 'text',
      text: { body: '¡Hola! Quiero más información' },
      referral: {
        source_url: 'https://fb.me/abc',
        source_type: 'ad',
        headline: 'Tu futuro en Virú',
        body: 'Por la compra de tu lote',
        image_url: 'https://lookaside.fbsbx.com/ad.jpg',
      },
    });
    expect(ctx).toEqual({
      source: 'facebook_ad',
      headline: 'Tu futuro en Virú',
      body: 'Por la compra de tu lote',
      image_url: 'https://lookaside.fbsbx.com/ad.jpg',
      source_url: 'https://fb.me/abc',
    });
  });
});

describe('toStoredAdContext / readStoredAdContext', () => {
  it('keeps an in-memory jpeg thumbnail off the stored row', () => {
    const ctx = extractAdContext({
      contextInfo: {
        externalAdReply: {
          title: 'Promo',
          thumbnailUrl: 'https://scontent.xx.fbcdn.net/x.jpg',
          sourceUrl: 'https://fb.me/x',
          showAdAttribution: true,
          jpegThumbnail: 'a'.repeat(100),
        },
      },
    });
    expect(ctx?.thumbnailBase64).toHaveLength(100);
    expect(toStoredAdContext(ctx!)).not.toHaveProperty('thumbnailBase64');
  });

  it('drops the in-memory thumbnail before persist', () => {
    const stored = toStoredAdContext({
      source: 'facebook_ad',
      headline: 'Hola',
      body: null,
      image_url: 'https://example.com/a.jpg',
      source_url: null,
      thumbnailBase64: 'aaaa',
    });
    expect(stored).not.toHaveProperty('thumbnailBase64');
    expect(readStoredAdContext(stored)?.headline).toBe('Hola');
  });
});
