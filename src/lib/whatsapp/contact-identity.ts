import {
  isLikelyWhatsAppLid,
  isRealMobilePhone,
} from '@/lib/whatsapp/phone-utils'

/** WhatsApp public usernames: 3–30 chars, letter first, then letters/digits/._ */
const USERNAME_RE = /^@?([a-zA-Z][a-zA-Z0-9._]{2,29})$/

export function normalizeWhatsAppUsername(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = USERNAME_RE.exec(trimmed)
  if (!match) return null
  return match[1].toLowerCase()
}

function pushUsernameCandidate(out: unknown[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) out.push(value)
}

/**
 * Pull a public @username out of a WAHA / Baileys inbound payload.
 * Phone-number chats leave this null.
 */
export function extractWhatsAppUsername(
  payload: Record<string, unknown>,
): string | null {
  const candidates: unknown[] = []
  const visitDedicated = (obj: Record<string, unknown> | null) => {
    if (!obj) return
    pushUsernameCandidate(candidates, obj.username)
    pushUsernameCandidate(candidates, obj.userName)
    const key =
      obj.key && typeof obj.key === 'object'
        ? (obj.key as Record<string, unknown>)
        : null
    if (key) {
      pushUsernameCandidate(candidates, key.remoteJidUsername)
      pushUsernameCandidate(candidates, key.participantUsername)
    }
  }
  const visitAtHandles = (obj: Record<string, unknown> | null) => {
    if (!obj) return
    for (const value of [obj.notifyName, obj.pushName, obj.pushname, obj.name]) {
      if (typeof value === 'string' && value.trim().startsWith('@')) {
        pushUsernameCandidate(candidates, value)
      }
    }
  }

  visitDedicated(payload)
  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null
  visitDedicated(data)
  const nestedContact =
    payload.contact && typeof payload.contact === 'object'
      ? (payload.contact as Record<string, unknown>)
      : null
  const nestedDataContact =
    data?.contact && typeof data.contact === 'object'
      ? (data.contact as Record<string, unknown>)
      : null
  visitDedicated(nestedContact)
  visitDedicated(nestedDataContact)
  visitAtHandles(payload)
  visitAtHandles(data)
  visitAtHandles(nestedContact)
  visitAtHandles(nestedDataContact)

  for (const c of candidates) {
    const username = normalizeWhatsAppUsername(c as string)
    if (username) return username
  }
  return null
}

export function contactDisplayName(
  contact: {
    name?: string | null
    phone?: string | null
    whatsapp_username?: string | null
    whatsapp_jid?: string | null
  } | null | undefined,
  fallback: string,
): string {
  if (!contact) return fallback
  const username = normalizeWhatsAppUsername(contact.whatsapp_username)
  const name = contact.name?.trim()
  if (
    name &&
    name !== contact.phone &&
    !isLikelyWhatsAppLid(name) &&
    !/^@/.test(name)
  ) {
    return name
  }
  if (username) return `@${username}`
  if (name?.startsWith('@')) return name
  return contactIdentityLabel(contact, fallback)
}

export function normalizeWhatsAppJid(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed.includes('@')) return null
  if (
    trimmed.endsWith('@g.us') ||
    trimmed.endsWith('@newsletter') ||
    trimmed === 'status@broadcast'
  ) {
    return null
  }
  return trimmed
}

export function contactHasRealPhone(
  contact: { phone?: string | null } | null | undefined,
): boolean {
  return isRealMobilePhone(contact?.phone)
}

/** Label under the name in the inbox: @user, phone, or “no number”. */
export function contactIdentityLabel(
  contact: {
    phone?: string | null
    whatsapp_username?: string | null
    whatsapp_jid?: string | null
  } | null | undefined,
  noPhoneLabel: string,
): string {
  if (!contact) return noPhoneLabel
  const username = normalizeWhatsAppUsername(contact.whatsapp_username)
  if (username) return `@${username}`
  if (contactHasRealPhone(contact)) return contact.phone as string
  if (isLikelyWhatsAppLid(contact.phone) || contact.whatsapp_jid) {
    return noPhoneLabel
  }
  return contact.phone?.trim() || noPhoneLabel
}

/**
 * Chat id WAHA should send to. Prefer the stored JID so username / LID
 * leads are not forced through a fake E.164 `@c.us`.
 */
export function wahaSendTarget(contact: {
  phone?: string | null
  whatsapp_jid?: string | null
}): string {
  const jid = normalizeWhatsAppJid(contact.whatsapp_jid)
  if (jid) return jid
  const phone = (contact.phone ?? '').trim()
  if (phone.toLowerCase().endsWith('@lid') || phone.includes('@')) return phone
  const digits = phone.replace(/\D/g, '')
  if (isLikelyWhatsAppLid(phone) && digits.length >= 8) {
    return `${digits}@lid`
  }
  return phone
}
