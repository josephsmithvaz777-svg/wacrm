// ============================================================
// Staff WhatsApp numbers must never be treated as leads
// ============================================================
//
// Advisors receive “Nuevo lead asignado” on their personal WhatsApp.
// If that number is then round-robin assigned to another advisor, the
// team starts handing *each other* around as leads. Match the contact
// against CRM member phones AND team-reminder numbers (saved external
// contacts + reminder recipients) and skip assignment / AI auto-reply.

import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function contactPhoneMatchesStaff(
  contactPhone: string | null | undefined,
  staffPhones: Array<string | null | undefined>,
): boolean {
  const phone = (contactPhone ?? '').trim();
  if (!phone) return false;
  return staffPhones.some((staff) => {
    const value = (staff ?? '').trim();
    if (!value) return false;
    if (phonesMatch(phone, value)) return true;
    const n1 = normalizePhone(phone);
    const n2 = normalizePhone(value);
    if (!n1 || !n2) return false;
    const [longer, shorter] = n1.length >= n2.length ? [n1, n2] : [n2, n1];
    // Profile saved as local digits (e.g. 940912791) vs inbound E.164
    // (51940912791). phonesMatch only compares the last 8 digits and
    // misses that case.
    return shorter.length >= 8 && longer.endsWith(shorter);
  });
}

function pushUniquePhones(
  into: string[],
  seen: Set<string>,
  phones: Array<string | null | undefined>,
): void {
  for (const raw of phones) {
    const phone = (raw ?? '').trim();
    if (!phone) continue;
    const key = normalizePhone(phone) || phone.replace(/\D/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    into.push(phone);
  }
}

/**
 * Phones that belong to the team for this account: CRM member profiles,
 * saved external reminder contacts, and numbers already on a team
 * reminder. Used so AI / round-robin / automations do not treat them
 * as leads.
 */
export async function loadAccountStaffPhones(
  db: Db,
  accountId: string,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();

  const { data: profiles, error: profileErr } = await db
    .from('profiles')
    .select('phone')
    .eq('account_id', accountId);
  if (profileErr) {
    console.warn('[staff-contact] load profile phones failed:', profileErr);
  } else {
    pushUniquePhones(
      out,
      seen,
      ((profiles ?? []) as { phone?: string | null }[]).map((row) => row.phone),
    );
  }

  const { data: externals, error: externalErr } = await db
    .from('staff_external_contacts')
    .select('phone')
    .eq('account_id', accountId);
  if (externalErr) {
    console.warn('[staff-contact] load external phones failed:', externalErr);
  } else {
    pushUniquePhones(
      out,
      seen,
      ((externals ?? []) as { phone?: string | null }[]).map((row) => row.phone),
    );
  }

  const { data: reminderPhones, error: reminderErr } = await db
    .from('staff_reminder_recipients')
    .select('phone')
    .eq('account_id', accountId)
    .not('phone', 'is', null);
  if (reminderErr) {
    console.warn('[staff-contact] load reminder phones failed:', reminderErr);
  } else {
    pushUniquePhones(
      out,
      seen,
      ((reminderPhones ?? []) as { phone?: string | null }[]).map(
        (row) => row.phone,
      ),
    );
  }

  return out;
}

export async function contactBelongsToAccountStaff(
  db: Db,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data: contact, error } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.warn('[staff-contact] load contact phone failed:', error);
    return false;
  }
  const phone = (contact?.phone as string | null | undefined) ?? null;
  if (!phone) return false;

  const staffPhones = await loadAccountStaffPhones(db, accountId);
  return contactPhoneMatchesStaff(phone, staffPhones);
}
