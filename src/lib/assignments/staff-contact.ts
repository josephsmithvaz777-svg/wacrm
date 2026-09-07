// ============================================================
// Staff WhatsApp numbers must never be treated as leads
// ============================================================
//
// Advisors receive “Nuevo lead asignado” on their personal WhatsApp.
// If that number is then round-robin assigned to another advisor, the
// team starts handing *each other* around as leads. Match the contact
// against `profiles.phone` for the account and skip assignment.

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

export async function loadAccountStaffPhones(
  db: Db,
  accountId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('profiles')
    .select('phone')
    .eq('account_id', accountId);
  if (error) {
    console.warn('[round-robin] load staff phones failed:', error);
    return [];
  }
  return ((data ?? []) as { phone?: string | null }[])
    .map((row) => row.phone)
    .filter((phone): phone is string => Boolean(phone && phone.trim()));
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
    console.warn('[round-robin] load contact phone failed:', error);
    return false;
  }
  const phone = (contact?.phone as string | null | undefined) ?? null;
  if (!phone) return false;

  const staffPhones = await loadAccountStaffPhones(db, accountId);
  return contactPhoneMatchesStaff(phone, staffPhones);
}
