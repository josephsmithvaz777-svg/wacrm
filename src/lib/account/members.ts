import type { AccountMember } from '@/types';
import { canReceiveLeads, canSendMessages, isAccountRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents/viewers don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(): Promise<AccountMember[]> {
  try {
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/** Display label for a member: full name → email → raw id. */
export function memberLabel(m: AccountMember): string {
  return m.full_name || m.email || m.user_id;
}

/** Members who may own a conversation. Owner/admin watch and write but do not keep the lead. */
export function assignableMembers(members: AccountMember[]): AccountMember[] {
  return members.filter((m) => canReceiveLeads(m.role));
}

/**
 * Teammates for the inbox assignee filter.
 *
 * Not the same as {@link assignableMembers}. Some accounts keep leads on
 * viewers, so a filter limited to role `agent` only offers "all" and
 * "unassigned". Every member of the account is a valid filter.
 */
export function membersForInboxFilter(members: AccountMember[]): AccountMember[] {
  return [...members].sort((a, b) =>
    memberLabel(a).localeCompare(memberLabel(b), 'es'),
  );
}

/**
 * Load the inbox filter roster. The members API is preferred (it hides
 * emails from agents). If it fails, read profiles directly — the same
 * query the thread header uses to show the current assignee.
 */
export async function fetchInboxFilterMembers(): Promise<AccountMember[]> {
  const fromApi = await fetchAccountMembers();
  const rows = fromApi.length > 0 ? fromApi : await membersFromProfiles();
  return membersForInboxFilter(rows);
}

async function membersFromProfiles(): Promise<AccountMember[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, avatar_url, account_role, created_at');
    if (error || !data) return [];
    return data.flatMap((row) => {
      const role = row.account_role;
      if (!isAccountRole(role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? '',
          email: row.email,
          avatar_url: row.avatar_url,
          role,
          joined_at: row.created_at,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Members who may own a task (anyone who can work the inbox). */
export function taskAssignableMembers(members: AccountMember[]): AccountMember[] {
  return members.filter((m) => canSendMessages(m.role));
}
