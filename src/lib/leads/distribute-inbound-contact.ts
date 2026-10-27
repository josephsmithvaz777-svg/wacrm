// Sheet / API leads never open a WhatsApp chat, so the inbox
// handoff (first inbound message → round-robin → notify_staff)
// never runs. This assigns the contact and WhatsApps the agent
// in the same request that created the row.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_STAFF_ALERT_TEXT,
  notifyStaffViaWhatsApp,
} from '@/lib/automations/staff-notify';
import { contactBelongsToAccountStaff } from '@/lib/assignments/staff-contact';
import { pickRoundRobinAgent } from '@/lib/assignments/round-robin';
import { ensureInboundLeadInFunnel } from '@/lib/pipelines/inbound-deal';

export async function distributeInboundContact(
  db: SupabaseClient,
  opts: {
    accountId: string;
    contactId: string;
    actorUserId: string;
    /** True when this request inserted the contact. Existing rows are
     *  distributed only while they still have no owner, so a repeated
     *  sheet sync does not WhatsApp the team again. */
    created: boolean;
  },
): Promise<string> {
  if (
    await contactBelongsToAccountStaff(db, opts.accountId, opts.contactId)
  ) {
    return 'skipped: staff phone';
  }

  const { data: contact } = await db
    .from('contacts')
    .select('assigned_to')
    .eq('id', opts.contactId)
    .eq('account_id', opts.accountId)
    .maybeSingle();
  const alreadyAssigned =
    (contact?.assigned_to as string | null | undefined) ?? null;
  if (!opts.created && alreadyAssigned) {
    return 'skipped: already assigned';
  }

  const { data: account } = await db
    .from('accounts')
    .select('round_robin_enabled')
    .eq('id', opts.accountId)
    .maybeSingle();
  if (!account?.round_robin_enabled) {
    return 'skipped: round robin off';
  }

  let agentId = alreadyAssigned;
  if (!agentId) {
    agentId = await pickRoundRobinAgent(db, opts.accountId);
    if (!agentId) return 'skipped: no agents';
    const { error } = await db
      .from('contacts')
      .update({
        assigned_to: agentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.contactId)
      .eq('account_id', opts.accountId);
    if (error) {
      console.warn('[distribute-inbound] assign failed:', error);
      return 'skipped: assign failed';
    }
  }

  await ensureInboundLeadInFunnel(db, {
    accountId: opts.accountId,
    contactId: opts.contactId,
    assignedAgentId: agentId,
    actorUserId: opts.actorUserId,
  });

  return notifyStaffViaWhatsApp({
    db,
    accountId: opts.accountId,
    contactId: opts.contactId,
    conversationId: null,
    assignedAgentId: agentId,
    notifyOwner: false,
    notifyAssigned: true,
    textTemplate: DEFAULT_STAFF_ALERT_TEXT,
    messageText: 'Formulario de Facebook',
  });
}
