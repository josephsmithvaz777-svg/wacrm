/**
 * Detect WhatsApp group / broadcast / channel chats so the Inbox can
 * hide them and the WAHA webhook can skip ingesting them.
 *
 * Cloud API is 1:1 only. WAHA (WhatsApp Web) still delivers group
 * events; engines disagree on which field holds the group JID
 * (`from`, `chatId`, `_data.key.remoteJid`, …).
 */

const GROUP_JID_RE = /@(g\.us|newsletter|broadcast)\b/i;

export function isWhatsAppGroupJid(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (v.toLowerCase() === 'status@broadcast') return true;
  return GROUP_JID_RE.test(v);
}

/**
 * True when a stored contact is (or was) a group chat rather than a
 * person. WAHA used to persist group JIDs as `contacts.phone` (digits
 * of `120363…@g.us`, or the older `owner-timestamp` form).
 */
export function isGroupContact(
  contact:
    | { phone?: string | null; phone_normalized?: string | null }
    | null
    | undefined,
): boolean {
  if (!contact) return false;
  const phone = contact.phone ?? '';
  if (isWhatsAppGroupJid(phone)) return true;

  const digits = (contact.phone_normalized || phone).replace(/\D/g, '');
  // Invite-link group ids start with 120363 and are longer than E.164.
  if (digits.startsWith('120363') && digits.length >= 15) return true;
  if (digits.length > 15) return true;

  // Legacy participant-owner group: "5491100000000-1234567890"
  const local = phone.replace(/@.*$/, '');
  if (/^\+?\d{6,15}-\d{6,}$/.test(local)) return true;

  return false;
}

function pushString(list: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) list.push(value.trim());
}

/** True when a WAHA inbound payload belongs to a group / channel / status. */
export function wahaPayloadIsGroup(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload) return false;
  if (payload.isGroup === true || payload.from_group === true) return true;

  const strings: string[] = [];
  pushString(strings, payload.from);
  pushString(strings, payload.to);
  pushString(strings, payload.chatId);
  pushString(strings, payload.participant);

  const data =
    payload._data && typeof payload._data === 'object'
      ? (payload._data as Record<string, unknown>)
      : null;
  if (data) {
    if (data.isGroup === true) return true;
    pushString(strings, data.from);
    pushString(strings, data.to);
    const key =
      data.key && typeof data.key === 'object'
        ? (data.key as Record<string, unknown>)
        : null;
    pushString(strings, key?.remoteJid);
    pushString(strings, key?.participant);
    const id =
      data.id && typeof data.id === 'object'
        ? (data.id as Record<string, unknown>)
        : null;
    pushString(strings, id?.remote);
    pushString(strings, id?.participant);
    const info =
      data.Info && typeof data.Info === 'object'
        ? (data.Info as Record<string, unknown>)
        : null;
    pushString(strings, info?.Chat);
  }

  return strings.some(isWhatsAppGroupJid);
}

export type ChatKindFilter = 'all' | 'direct' | 'groups';

export function matchesChatKindFilter(
  isGroup: boolean,
  kind: ChatKindFilter,
): boolean {
  if (kind === 'direct') return !isGroup;
  if (kind === 'groups') return isGroup;
  return true;
}
