// ============================================================
// Round-robin agent assignment
// ============================================================

import { contactBelongsToAccountStaff } from '@/lib/assignments/staff-contact';
import {
  canReceiveLeads,
  isAccountRole,
  ROLES_THAT_RECEIVE_LEADS,
} from '@/lib/auth/roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * True when `agentId` is a member of the account who may own a lead
 * (owner / agent). Admins and viewers are never eligible.
 */
export async function agentCanReceiveLeads(
  db: Db,
  accountId: string,
  agentId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('profiles')
    .select('account_role')
    .eq('account_id', accountId)
    .eq('user_id', agentId)
    .maybeSingle();
  if (error) {
    console.warn('[round-robin] load assignee role failed:', error);
    return false;
  }
  const role = data?.account_role;
  return isAccountRole(role) && canReceiveLeads(role);
}

/**
 * Pick the next owner/agent in stable user_id order for an account,
 * advance the cursor on `accounts.round_robin_last_user_id`, and
 * return the chosen user id (or null if no eligible members).
 *
 * Admins and viewers are excluded from the pool — they can watch
 * the inbox but must never be auto-assigned a conversation. Owners
 * stay in: a one-person workspace still has someone to hand to.
 */
export async function pickRoundRobinAgent(
  db: Db,
  accountId: string,
): Promise<string | null> {
  const { data: account } = await db
    .from('accounts')
    .select('round_robin_last_user_id')
    .eq('id', accountId)
    .maybeSingle();

  const { data: agents, error } = await db
    .from('profiles')
    .select('user_id, account_role')
    .eq('account_id', accountId)
    .in('account_role', [...ROLES_THAT_RECEIVE_LEADS])
    .order('user_id', { ascending: true });

  const eligible = (
    (agents ?? []) as { user_id: string; account_role?: string }[]
  ).filter(
    (a) => isAccountRole(a.account_role) && canReceiveLeads(a.account_role),
  );

  if (error || !eligible.length) {
    if (error) console.warn('[round-robin] load agents failed:', error);
    return null;
  }

  const last =
    typeof account?.round_robin_last_user_id === 'string'
      ? (account.round_robin_last_user_id as string)
      : null;
  const idx = last
    ? eligible.findIndex((a) => a.user_id === last)
    : -1;
  const next = eligible[(idx + 1) % eligible.length];
  if (!next?.user_id) return null;

  const { error: updErr } = await db
    .from('accounts')
    .update({
      round_robin_last_user_id: next.user_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);
  if (updErr) {
    console.warn('[round-robin] cursor update failed:', updErr);
  }

  return next.user_id;
}

/**
 * Assign conversation + contact to an agent (best-effort contact sync).
 * No-ops and returns false when the target cannot receive leads
 * (admin, viewer, or not a member).
 */
export async function assignConversationToAgent(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId?: string | null;
    agentId: string;
  },
): Promise<boolean> {
  const eligible = await agentCanReceiveLeads(db, opts.accountId, opts.agentId);
  if (!eligible) {
    console.warn(
      '[round-robin] skip assign: target cannot receive leads',
      opts.agentId,
    );
    return false;
  }

  let convUpdate = db
    .from('conversations')
    .update({ assigned_agent_id: opts.agentId })
    .eq('account_id', opts.accountId)
    .eq('contact_id', opts.contactId);
  if (opts.conversationId) {
    convUpdate = convUpdate.eq('id', opts.conversationId);
  }
  const { error: convErr } = await convUpdate;
  if (convErr) {
    console.warn('[round-robin] conversation assign failed:', convErr);
  }

  const { error: contactErr } = await db
    .from('contacts')
    .update({
      assigned_to: opts.agentId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.contactId);
  if (contactErr) {
    console.warn('[round-robin] contact assigned_to sync failed:', contactErr);
  }
  return !convErr;
}

async function clearConversationAssignment(
  db: Db,
  opts: { accountId: string; contactId: string; conversationId: string },
): Promise<void> {
  await db
    .from('conversations')
    .update({ assigned_agent_id: null })
    .eq('id', opts.conversationId)
    .eq('account_id', opts.accountId);
  await db
    .from('contacts')
    .update({
      assigned_to: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.contactId)
    .eq('account_id', opts.accountId);
}

/**
 * True when the account's AI assistant is live and will auto-reply.
 * New inbound threads should stay unassigned in that case so the bot
 * can qualify the lead; round-robin assignment runs later, on handoff.
 */
export async function accountHasActiveAiAutoReply(
  db: Db,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('ai_configs')
    .select('is_active, auto_reply_enabled, api_key')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.warn('[round-robin] load ai_configs failed:', error);
    return false;
  }
  return Boolean(data?.is_active && data?.auto_reply_enabled && data?.api_key);
}

/**
 * Who should own the thread when the AI hands off: the next advisor
 * in round-robin (owner/agent). Null only if nobody is eligible.
 */
export async function resolveHandoffAssignee(
  db: Db,
  accountId: string,
): Promise<string | null> {
  return pickRoundRobinAgent(db, accountId);
}

/**
 * If the account has round_robin_enabled and the conversation is new /
 * unassigned, pick the next agent and assign.
 *
 * Skips assignment when AI auto-reply is on: the bot owns the first
 * stretch of the chat, and the advisor is assigned on handoff.
 *
 * Also reassigns when the current assignee is an admin, viewer, or
 * otherwise ineligible. Leaving those threads in place kept sending
 * WhatsApp alerts to people who can only watch the inbox.
 *
 * Never assigns when the contact's phone belongs to a teammate —
 * advisor numbers are inboxes, not leads.
 */
export async function maybeRoundRobinAssignNewConversation(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId: string;
    alreadyAssigned?: string | null;
  },
): Promise<string | null> {
  if (await contactBelongsToAccountStaff(db, opts.accountId, opts.contactId)) {
    console.info(
      '[round-robin] skip assign: contact is a staff phone',
      opts.contactId,
    );
    return null;
  }

  const current = opts.alreadyAssigned ?? null;
  if (current) {
    const eligible = await agentCanReceiveLeads(db, opts.accountId, current);
    if (eligible) return null;
  }

  if (await accountHasActiveAiAutoReply(db, opts.accountId)) {
    if (current) {
      await clearConversationAssignment(db, opts);
    }
    return null;
  }

  const { data: account } = await db
    .from('accounts')
    .select('round_robin_enabled')
    .eq('id', opts.accountId)
    .maybeSingle();

  if (!account?.round_robin_enabled) {
    if (current) {
      await clearConversationAssignment(db, opts);
    }
    return null;
  }

  const agentId = await pickRoundRobinAgent(db, opts.accountId);
  if (!agentId) {
    if (current) {
      await clearConversationAssignment(db, opts);
    }
    return null;
  }

  await assignConversationToAgent(db, {
    accountId: opts.accountId,
    contactId: opts.contactId,
    conversationId: opts.conversationId,
    agentId,
  });
  return agentId;
}
