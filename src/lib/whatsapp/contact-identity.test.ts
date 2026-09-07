import { describe, expect, it } from 'vitest'
import {
  contactIdentityLabel,
  extractWhatsAppUsername,
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

  it('reads @Mr.lovin.16 style handles from notifyName', () => {
    expect(
      extractWhatsAppUsername({ notifyName: '@Mr.lovin.16' }),
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
  it('keeps user and lid chats, drops groups', () => {
    expect(normalizeWhatsAppJid('123@lid')).toBe('123@lid')
    expect(normalizeWhatsAppJid('120363@g.us')).toBeNull()
  })
})
