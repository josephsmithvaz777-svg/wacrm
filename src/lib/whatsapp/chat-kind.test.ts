import { describe, expect, it } from 'vitest';
import {
  isGroupContact,
  isWhatsAppGroupJid,
  matchesChatKindFilter,
  wahaPayloadIsGroup,
} from './chat-kind';

describe('isWhatsAppGroupJid', () => {
  it('detects group, newsletter, and status JIDs', () => {
    expect(isWhatsAppGroupJid('120363012345678901@g.us')).toBe(true);
    expect(isWhatsAppGroupJid('120363012345678901@newsletter')).toBe(true);
    expect(isWhatsAppGroupJid('status@broadcast')).toBe(true);
    expect(isWhatsAppGroupJid('5511999999999@broadcast')).toBe(true);
  });

  it('rejects 1:1 chat ids', () => {
    expect(isWhatsAppGroupJid('51931387898@c.us')).toBe(false);
    expect(isWhatsAppGroupJid('123456789012345@lid')).toBe(false);
    expect(isWhatsAppGroupJid('')).toBe(false);
    expect(isWhatsAppGroupJid(null)).toBe(false);
  });
});

describe('isGroupContact', () => {
  it('flags stored group JIDs and 120363 ids', () => {
    expect(isGroupContact({ phone: '120363012345678901@g.us' })).toBe(true);
    expect(
      isGroupContact({ phone: 'Netflix', phone_normalized: '12036314841234567' }),
    ).toBe(true);
    expect(isGroupContact({ phone: '5491100000000-1234567890' })).toBe(true);
  });

  it('treats normal phones as direct chats', () => {
    expect(isGroupContact({ phone: '+51 931 387 898', phone_normalized: '51931387898' })).toBe(
      false,
    );
    expect(isGroupContact(null)).toBe(false);
  });
});

describe('wahaPayloadIsGroup', () => {
  it('reads from / chatId / nested remoteJid', () => {
    expect(
      wahaPayloadIsGroup({ from: '120363012345678901@g.us', body: 'hi' }),
    ).toBe(true);
    expect(
      wahaPayloadIsGroup({
        from: '51931387898@c.us',
        chatId: '120363012345678901@g.us',
      }),
    ).toBe(true);
    expect(
      wahaPayloadIsGroup({
        from: '51931387898@c.us',
        _data: { key: { remoteJid: '120363012345678901@g.us' } },
      }),
    ).toBe(true);
    expect(wahaPayloadIsGroup({ isGroup: true, from: '5193@c.us' })).toBe(true);
  });

  it('lets 1:1 messages through', () => {
    expect(
      wahaPayloadIsGroup({ from: '51931387898@c.us', body: 'hola' }),
    ).toBe(false);
  });
});

describe('matchesChatKindFilter', () => {
  it('hides groups when filtering to direct chats', () => {
    expect(matchesChatKindFilter(true, 'direct')).toBe(false);
    expect(matchesChatKindFilter(false, 'direct')).toBe(true);
    expect(matchesChatKindFilter(true, 'groups')).toBe(true);
    expect(matchesChatKindFilter(false, 'all')).toBe(true);
  });
});
