import type { SupabaseClient } from '@supabase/supabase-js';

import { canReceiveLeads, isAccountRole } from '@/lib/auth/roles';

import { engineSendText } from '@/lib/automations/meta-send';
import {
  formatAlertClock,
  formatAlertDateTime,
} from '@/lib/automations/template-vars';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { findOrCreateConversation } from '@/lib/conversations/find-or-create';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import {
  isRealMobilePhone,
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { sendWahaText, type WahaClientOptions } from '@/lib/whatsapp/waha-api';

export const DEFAULT_STAFF_ALERT_TEXT =
  'Nuevo lead asignado\nNombre: {{contact_name}}\nNúmero: {{contact_phone}}\nHora: {{time}}\n{{message.text}}';

export type StaffNotifyRole = 'owner' | 'assigned_agent';

export interface StaffNotifyCandidate {
  userId: string;
  role: StaffNotifyRole;
  phone: string | null;
  name: string | null;
}

export interface StaffNotifyTarget extends StaffNotifyCandidate {
  phone: string;
}

export function staffPhoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * Staff alerts go to a personal mobile, not a WhatsApp Linked ID.
 * LIDs in this workspace show up as 14+ digit blobs (e.g.
 * 38323993190459); real E.164 mobiles we care about are shorter.
 */
export function isUsableStaffPhone(phone: string | null | undefined): boolean {
  return isRealMobilePhone(phone);
}

export function renderStaffAlert(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? '';
  });
}

/**
 * Drop empty / LID-like numbers, skip the customer's own phone (so a
 * staff reply cannot re-alert the same people in a loop), and keep one
 * row per number when the owner is also the assigned agent.
 */
export function pickStaffNotifyTargets(
  candidates: StaffNotifyCandidate[],
  contactPhone: string | null,
): StaffNotifyTarget[] {
  const contactDigits = staffPhoneDigits(contactPhone);
  const seen = new Set<string>();
  const out: StaffNotifyTarget[] = [];
  for (const candidate of candidates) {
    if (!isUsableStaffPhone(candidate.phone)) continue;
    const digits = staffPhoneDigits(candidate.phone);
    if (contactDigits && digits === contactDigits) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push({ ...candidate, phone: digits });
  }
  return out;
}

export async function notifyStaffViaWhatsApp(params: {
  db: SupabaseClient;
  accountId: string;
  contactId: string | null | undefined;
  conversationId: string | null | undefined;
  assignedAgentId?: string | null;
  notifyOwner: boolean;
  notifyAssigned: boolean;
  textTemplate: string;
  messageText: string;
}): Promise<string> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    assignedAgentId,
    notifyOwner,
    notifyAssigned,
    textTemplate,
    messageText,
  } = params;

  if (!notifyOwner && !notifyAssigned) {
    throw new Error('notify_staff needs at least one recipient');
  }

  let contactName = '';
  let contactPhone: string | null = null;
  if (contactId) {
    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    contactName = (contact?.name as string | null | undefined)?.trim() || '';
    contactPhone = (contact?.phone as string | null | undefined) ?? null;
  }

  const candidates: StaffNotifyCandidate[] = [];
  const skipReasons: string[] = [];

  if (notifyOwner) {
    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    const ownerId = account?.owner_user_id as string | undefined;
    if (ownerId) {
      const { data: owner } = await db
        .from('profiles')
        .select('user_id, phone, full_name')
        .eq('user_id', ownerId)
        .maybeSingle();
      const phone = (owner?.phone as string | null | undefined) ?? null;
      if (!isUsableStaffPhone(phone)) {
        skipReasons.push(
          'owner has no WhatsApp number in Settings → Profile',
        );
      }
      candidates.push({
        userId: ownerId,
        role: 'owner',
        phone,
        name: (owner?.full_name as string | null | undefined) ?? null,
      });
    }
  }

  if (notifyAssigned) {
    let agentId = assignedAgentId ?? null;
    if (conversationId) {
      const { data: conv } = await db
        .from('conversations')
        .select('assigned_agent_id')
        .eq('id', conversationId)
        .eq('account_id', accountId)
        .maybeSingle();
      agentId =
        (conv?.assigned_agent_id as string | null | undefined) ?? agentId;
    }
    if (!agentId) {
      skipReasons.push('conversation has no assigned agent');
    } else {
      const { data: agent } = await db
        .from('profiles')
        .select('user_id, phone, full_name, account_role')
        .eq('user_id', agentId)
        .maybeSingle();
      const role = agent?.account_role;
      if (!isAccountRole(role) || !canReceiveLeads(role)) {
        skipReasons.push('assigned agent is a viewer and cannot receive leads');
      } else {
        const phone = (agent?.phone as string | null | undefined) ?? null;
        if (!isUsableStaffPhone(phone)) {
          skipReasons.push(
            'assigned agent has no WhatsApp number in Settings → Profile',
          );
        }
        candidates.push({
          userId: agentId,
          role: 'assigned_agent',
          phone,
          name: (agent?.full_name as string | null | undefined) ?? null,
        });
      }
    }
  }

  const targets = pickStaffNotifyTargets(candidates, contactPhone);
  if (!targets.length) {
    const extra = skipReasons.length ? skipReasons.join('; ') : 'no staff WhatsApp numbers to notify';
    return `skipped: ${extra}`;
  }

  const now = new Date();
  const time = formatAlertDateTime(now);
  const clock = formatAlertClock(now);
  const text = renderStaffAlert(textTemplate || DEFAULT_STAFF_ALERT_TEXT, {
    'contact_name': contactName || contactPhone || 'contacto',
    'contact_phone': contactPhone || '',
    'message.text': messageText || '',
    'agent_name':
      targets.find((row) => row.role === 'assigned_agent')?.name || '',
    time,
    hora: clock,
    received_at: time,
  }).trim();
  if (!text) throw new Error('notify_staff has empty text');

  const sent: string[] = [];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      await sendStaffWhatsApp(db, {
        accountId,
        toPhone: target.phone,
        toName: target.name,
        text,
      });
      sent.push(target.role);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push(`${target.role}: ${reason}`);
    }
  }

  if (!sent.length) {
    throw new Error(`notify_staff failed: ${errors.join('; ')}`);
  }
  const summary = `notified ${sent.join(', ')}`;
  return errors.length ? `${summary} (${errors.join('; ')})` : summary;
}

/**
 * The inbox line that receives leads. If WAHA is wired we always send
 * from that session — leftover Meta Cloud credentials must not become
 * a second "from" number.
 */
export function staffAlertChannel(config: {
  provider?: string | null;
  waha_base_url?: string | null;
}): 'waha' | 'meta' {
  if (config.waha_base_url) return 'waha';
  return (config.provider as string | undefined) === 'waha' ? 'waha' : 'meta';
}

async function sendStaffWhatsApp(
  db: SupabaseClient,
  args: {
    accountId: string;
    toPhone: string;
    toName: string | null;
    text: string;
  },
): Promise<void> {
  const { accountId, toPhone, toName, text } = args;
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select(
      'provider, waha_base_url, waha_session, access_token, phone_number_id, user_id',
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !config) {
    throw new Error('WhatsApp is not configured');
  }

  const ownerUserId = config.user_id as string | undefined;
  if (ownerUserId) {
    const contactId = await ensureStaffContact(
      db,
      accountId,
      ownerUserId,
      toPhone,
      toName,
    );
    const conversationId = await findOrCreateConversation(
      db,
      accountId,
      ownerUserId,
      contactId,
    );
    if (conversationId) {
      await engineSendText({
        accountId,
        userId: ownerUserId,
        conversationId,
        contactId,
        text,
      });
      return;
    }
  }

  // Fallback if we cannot open a thread: still send from the same
  // WAHA session / Meta phone that receives inbound leads.
  const accessToken = config.access_token
    ? decrypt(config.access_token as string)
    : '';
  if (staffAlertChannel(config) === 'waha') {
    if (!config.waha_base_url) {
      throw new Error('WAHA base URL is missing');
    }
    const opts: WahaClientOptions = {
      baseUrl: config.waha_base_url as string,
      apiKey: accessToken || null,
      session: (config.waha_session as string) || 'default',
    };
    await sendWahaText(opts, toPhone, text);
    return;
  }

  if (!config.phone_number_id || !accessToken) {
    throw new Error('WhatsApp inbox number is not configured');
  }
  const sanitized = sanitizePhoneForMeta(toPhone);
  if (!isValidE164(sanitized)) {
    throw new Error(`Invalid staff phone: ${toPhone}`);
  }
  await sendTextMessage({
    phoneNumberId: config.phone_number_id as string,
    accessToken,
    to: sanitized,
    text,
  });
}

async function ensureStaffContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string | null,
): Promise<string> {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing?.id) return existing.id as string;

  const label = (name ?? '').trim() || phone;
  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: label,
    })
    .select('id')
    .single();
  if (data?.id) return data.id as string;
  if (error && isUniqueViolation(error)) {
    const raced = await findExistingContact(db, accountId, phone);
    if (raced?.id) return raced.id as string;
  }
  throw new Error(
    error?.message || 'could not open a chat with the advisor number',
  );
}
