import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a
 * single thread per contact.
 *
 * Runs under the caller's RLS — the conversations_insert policy requires
 * account agent membership, which every caller here already has.
 *
 * Shared by the two entry points that can start a thread from a contact
 * rather than from an existing conversation: the dashboard send route
 * (template send from the contact sheet) and the "open chat" action in
 * the Contacts UI. Both must land on the same row, or a contact ends up
 * with two threads.
 */
export async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[conversations] create for contact failed:', error.message);
    return null;
  }

  return created.id;
}
