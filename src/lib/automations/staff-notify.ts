import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import {
  isRealMobilePhone,
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { sendWahaText, type WahaClientOptions } from '@/lib/whatsapp/waha-api';

export const DEFAULT_STAFF_ALERT_TEXT =
  'Nuevo mensaje de {{contact_name}} ({{contact_phone}}):\n{{message.text}}';

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
      candidates.push({
        userId: ownerId,
        role: 'owner',
        phone: (owner?.phone as string | null | undefined) ?? null,
        name: (owner?.full_name as string | null | undefined) ?? null,
      });
    }
  }

  if (notifyAssigned && conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    const agentId = conv?.assigned_agent_id as string | null | undefined;
    if (agentId) {
      const { data: agent } = await db
        .from('profiles')
        .select('user_id, phone, full_name')
        .eq('user_id', agentId)
        .maybeSingle();
      candidates.push({
        userId: agentId,
        role: 'assigned_agent',
        phone: (agent?.phone as string | null | undefined) ?? null,
        name: (agent?.full_name as string | null | undefined) ?? null,
      });
    }
  }

  const targets = pickStaffNotifyTargets(candidates, contactPhone);
  if (!targets.length) {
    return 'skipped: no staff WhatsApp numbers to notify';
  }

  const text = renderStaffAlert(textTemplate || DEFAULT_STAFF_ALERT_TEXT, {
    'contact_name': contactName || contactPhone || 'contacto',
    'contact_phone': contactPhone || '',
    'message.text': messageText || '',
    'agent_name':
      targets.find((row) => row.role === 'assigned_agent')?.name || '',
  }).trim();
  if (!text) throw new Error('notify_staff has empty text');

  const sent: string[] = [];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      await sendStaffWhatsApp(db, accountId, target.phone, text);
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

async function sendStaffWhatsApp(
  db: SupabaseClient,
  accountId: string,
  toPhone: string,
  text: string,
): Promise<void> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('provider, waha_base_url, waha_session, access_token, phone_number_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !config) {
    throw new Error('WhatsApp is not configured');
  }

  const provider = (config.provider as string | undefined) || 'meta';
  const accessToken = config.access_token
    ? decrypt(config.access_token as string)
    : '';

  if (provider === 'waha') {
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
    throw new Error('Meta WhatsApp is not configured');
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
