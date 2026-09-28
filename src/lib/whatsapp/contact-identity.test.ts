import { describe, expect, it } from 'vitest'
import {
  contactDisplayName,
  contactIdentityLabel,
  extractWhatsAppUsername,
  isIgnoredWhatsAppBroadcastJid,
  isWhatsAppGroupJid,
  normalizeWhatsAppJid,
  normalizeWhatsAppUsername,
  wahaSendTarget,
} from './contact-identity'

describe('normalizeWhatsAppUsername', () => {
  it('strips @ and lowercases', () => {
    expect(normalizeWhatsAppUsername('@Miladi.Machado')).toBe('miladi.machado')
  })

  it('rejects phones and junk', () => {
    expect(normalizeWhatsAppUsername('51988176761')).toBeNull()
    expect(normalizeWhatsAppUsername('ab')).toBeNull()
    expect(normalizeWhatsAppUsername('')).toBeNull()
  })
})

describe('extractWhatsAppUsername', () => {
  it('reads key.remoteJidUsername from Baileys-style payloads', () => {
    expect(
      extractWhatsAppUsername({
        key: { remoteJidUsername: 'miladi.m' },
        pushName: 'M.E',
      }),
    ).toBe('miladi.m')
  })

  it('reads username from a WAHA contact record', () => {
    expect(
      extractWhatsAppUsername({
        id: '107494928027812@lid',
        username: 'Mr.lovin.16',
        name: 'REBLEX',
      }),
    ).toBe('mr.lovin.16')
  })

  it('reads @handle from name when WhatsApp hides the phone', () => {
    expect(
      extractWhatsAppUsername({
        id: '107494928027812@lid',
        name: '@Mr.lovin.16',
      }),
    ).toBe('mr.lovin.16')
  })
})

describe('contactIdentityLabel', () => {
  it('prefers @username over a LID blob', () => {
    expect(
      contactIdentityLabel(
        {
          phone: '107494928027812',
          whatsapp_username: 'miladi.m',
        },
        'Sin número',
      ),
    ).toBe('@miladi.m')
  })

  it('shows a real mobile', () => {
    expect(
      contactIdentityLabel({ phone: '51988176761' }, 'Sin número'),
    ).toBe('51988176761')
  })

  it('hides LID digits when there is no username', () => {
    expect(
      contactIdentityLabel({ phone: '107494928027812' }, 'Sin número'),
    ).toBe('Sin número')
  })
})

describe('wahaSendTarget', () => {
  it('sends to the stored LID jid', () => {
    expect(
      wahaSendTarget({
        phone: '107494928027812',
        whatsapp_jid: '107494928027812@lid',
      }),
    ).toBe('107494928027812@lid')
  })

  it('turns a 14+ digit phone into @lid', () => {
    expect(wahaSendTarget({ phone: '107494928027812' })).toBe(
      '107494928027812@lid',
    )
  })
})

describe('normalizeWhatsAppJid', () => {
  it('keeps user, lid, and group chats; drops broadcast channels', () => {
    expect(normalizeWhatsAppJid('123@lid')).toBe('123@lid')
    expect(normalizeWhatsAppJid('120363041234567890@g.us')).toBe(
      '120363041234567890@g.us',
    )
    expect(normalizeWhatsAppJid('123@newsletter')).toBeNull()
    expect(normalizeWhatsAppJid('status@broadcast')).toBeNull()
  })
})

describe('whatsapp group jids', () => {
  it('detects @g.us and ignores newsletters', () => {
    expect(isWhatsAppGroupJid('120363041234567890@g.us')).toBe(true)
    expect(isWhatsAppGroupJid('51999111222@c.us')).toBe(false)
    expect(isIgnoredWhatsAppBroadcastJid('status@broadcast')).toBe(true)
    expect(isIgnoredWhatsAppBroadcastJid('120363@g.us')).toBe(false)
  })

  it('uses the group subject as the display name', () => {
    expect(
      contactDisplayName(
        {
          name: 'Equipo ventas',
          phone: '120363041234567890',
          whatsapp_jid: '120363041234567890@g.us',
          is_whatsapp_group: true,
        },
        'Grupo',
      ),
    ).toBe('Equipo ventas')
  })

  it('falls back to the group label when the stored name is the id', () => {
    expect(
      contactDisplayName(
        {
          name: '120363041234567890',
          phone: '120363041234567890',
          is_whatsapp_group: true,
        },
        'Grupo',
      ),
    ).toBe('Grupo')
  })

  it('labels the identity as a group, not a missing phone', () => {
    expect(
      contactIdentityLabel(
        {
          phone: '120363041234567890',
          whatsapp_jid: '120363041234567890@g.us',
          is_whatsapp_group: true,
        },
        'Sin número',
        'Grupo',
      ),
    ).toBe('Grupo')
  })
})

describe('wahaSendTarget groups', () => {
  it('sends to the stored @g.us jid', () => {
    expect(
      wahaSendTarget({
        phone: '120363041234567890',
        whatsapp_jid: '120363041234567890@g.us',
      }),
    ).toBe('120363041234567890@g.us')
  })
})
