import { describe, expect, it } from 'vitest';
import {
  chatIdToPhone,
  extractInboundText,
  extractWahaMeId,
  extractWahaMessageId,
  isWahaFromMe,
  parseWahaSerializedId,
  phoneToChatId,
  pickOutboundChatJid,
} from './waha-api';

describe('waha-api phone helpers', () => {
  it('phoneToChatId strips non-digits and appends @c.us', () => {
    expect(phoneToChatId('+1 (213) 213-2130')).toBe('12132132130@c.us');
  });

  it('chatIdToPhone extracts digits', () => {
    expect(chatIdToPhone('12132132130@c.us')).toBe('12132132130');
  });
});

describe('extractWahaMessageId', () => {
  it('reads a WEBJS string id', () => {
    expect(
      extractWahaMessageId({ id: 'true_51929793857@c.us_3EB0ABC' }),
    ).toBe('true_51929793857@c.us_3EB0ABC');
  });

  it('reads GOWS object id._serialized', () => {
    expect(
      extractWahaMessageId({
        id: {
          fromMe: true,
          remote: '51929793857@s.whatsapp.net',
          id: '3EB0ABC',
          _serialized: 'true_51929793857@s.whatsapp.net_3EB0ABC',
        },
      }),
    ).toBe('true_51929793857@s.whatsapp.net_3EB0ABC');
  });

  it('reads key.id when id is missing', () => {
    expect(
      extractWahaMessageId({
        key: { fromMe: true, id: '3EB0ABC', remoteJid: '51929793857@c.us' },
      }),
    ).toBe('3EB0ABC');
  });

  it('returns null when nothing usable is present', () => {
    expect(extractWahaMessageId({})).toBeNull();
    expect(extractWahaMessageId({ id: '' })).toBeNull();
  });
});

describe('isWahaFromMe', () => {
  it('detects top-level fromMe', () => {
    expect(isWahaFromMe({ fromMe: true, body: 'hola' })).toBe(true);
    expect(isWahaFromMe({ fromMe: false, body: 'hola' })).toBe(false);
  });

  it('detects WEBJS true_ id prefix when fromMe is omitted', () => {
    expect(
      isWahaFromMe({ id: 'true_51929793857@c.us_3EB0ABC', body: 'hola' }),
    ).toBe(true);
    expect(
      isWahaFromMe({ id: 'false_51929793857@c.us_3EB0ABC', body: 'hola' }),
    ).toBe(false);
  });

  it('detects nested GOWS id.fromMe / _data.Info.IsFromMe', () => {
    expect(
      isWahaFromMe({
        id: { fromMe: true, id: '3EB0ABC' },
        body: 'hola',
      }),
    ).toBe(true);
    expect(
      isWahaFromMe({
        _data: { Info: { IsFromMe: true } },
        body: 'hola',
      }),
    ).toBe(true);
  });
});

describe('pickOutboundChatJid', () => {
  const me = '51999111222@c.us';
  const contact = '584286373386@c.us';

  it('WEBJS: uses chatId, not to (to is our number)', () => {
    expect(
      pickOutboundChatJid(
        { fromMe: true, from: contact, to: me, chatId: contact },
        me,
      ),
    ).toBe(contact);
  });

  it('WEBJS without me: still prefers chatId over to', () => {
    expect(
      pickOutboundChatJid(
        { fromMe: true, from: contact, to: me, chatId: contact },
        null,
      ),
    ).toBe(contact);
  });

  it('WEBJS LID chat: prefers serialized remote JID over to=me', () => {
    expect(
      pickOutboundChatJid(
        {
          fromMe: true,
          to: '51999111222@c.us',
          id: 'true_184086660382908@lid_A54F679B94AEB426E11E5D3739E3BDE2',
        },
        '51999111222@c.us',
      ),
    ).toBe('184086660382908@lid');
  });

  it('GOWS: skips from=me and uses to/remoteJid', () => {
    expect(
      pickOutboundChatJid(
        {
          fromMe: true,
          from: me,
          to: contact,
          key: { remoteJid: contact, fromMe: true },
        },
        me,
      ),
    ).toBe(contact);
  });
});

describe('extractInboundText', () => {
  it('reads GOWS _data.Message.conversation', () => {
    expect(
      extractInboundText({
        _data: { Message: { conversation: 'Bendicion madre' } },
      }),
    ).toBe('Bendicion madre');
  });

  it('reads payload.caption when body is empty', () => {
    expect(extractInboundText({ caption: 'foto' })).toBe('foto');
  });
});

describe('parseWahaSerializedId', () => {
  it('parses WEBJS true_ LID ids from the Event Monitor', () => {
    expect(
      parseWahaSerializedId(
        'true_184086660382908@lid_A54F679B94AEB426E11E5D3739E3BDE2',
      ),
    ).toEqual({
      fromMe: true,
      remoteJid: '184086660382908@lid',
      messageId: 'A54F679B94AEB426E11E5D3739E3BDE2',
    });
  });

  it('parses inbound false_ LID ids', () => {
    expect(
      parseWahaSerializedId(
        'false_184086660382908@lid_A56B6E07451C6B471362A49A6573C3EF',
      )?.fromMe,
    ).toBe(false);
  });
});
