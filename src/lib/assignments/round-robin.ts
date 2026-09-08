// ============================================================
// Round-robin agent assignment
// ============================================================

import { contactBelongsToAccountStaff } from '@/lib/assignments/staff-contact';
import { isAccountRole } from '@/lib/auth/roles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Owner is only a last-resort fallback when the account has no agents. */
const AUTO_ASSIGN_LOOKUP_ROLES = ['owner', 'agent'] as const;

/**
 * Advisors who may receive an auto-assigned lead. Agents always.
 * The owner is included only when the account has no agents — a
 * one-person workspace still needs someone to hand to. Owner/admin
 * otherwise watch and write without keeping the lead.
 */
export function autoAssignPool(
  members: {
    user_id: string
    account_role?: string
    round_robin_order?: number | null
  }[],
): { user_id: string; account_role?: string; round_robin_order?: number | null }[] {
  const advisors = members.filter(
    (a) => isAccountRole(a.account_role) && a.account_role === 'agent',
  )
  const pool = advisors.length > 0
    ? advisors
    : members.filter((a) => a.account_role === 'owner')
  return [...pool].sort(compareRoundRobinOrder)
}

export function compareRoundRobinOrder(
  a: { user_id: string; round_robin_order?: number | null },
  b: { user_id: string; round_robin_order?: number | null },
): number {
  const aOrder = a.round_robin_order
  const bOrder = b.round_robin_order
  const aMissing = aOrder == null
  const bMissing = bOrder == null
  if (aMissing !== bMissing) return aMissing ? 1 : -1
  if (!aMissing && !bMissing && aOrder !== bOrder) return aOrder - bOrder
  return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0
}

async function loadAutoAssignPool(
  db: Db,
  accountId: string,
): Promise<{ user_id: string; account_role?: string }[]> {
  const { data: agents, error } = await db
    .from('profiles')
    .select('user_id, account_role, round_robin_order')
    .eq('account_id', accountId)
    .in('account_role', [...AUTO_ASSIGN_LOOKUP_ROLES]);
  if (error) {
    console.warn('[round-robin] load agents failed:', error);
    return [];
  }
  return autoAssignPool(
    (agents ?? []) as { user_id: string; account_role?: string }[],
  );
}

export async function userIsInAutoAssignPool(
  db: Db,
  accountId: string,
  userId: string,
): Promise<boolean> {
  const pool = await loadAutoAssignPool(db, accountId);
  return pool.some((a) => a.user_id === userId);
}

/**
 * True when `agentId` may keep a lead in this account: an agent, or
 * the owner only when there are no agents. Matches the auto pool so
 * Take over / Asignar cannot park a lead on the proprietor.
 */
export async function agentCanReceiveLeads(
  db: Db,
  accountId: string,
  agentId: string,
): Promise<boolean> {
  return userIsInAutoAssignPool(db, accountId, agentId);
}

/**
 * Pick the next owner/agent in round_robin_order (then user_id),
 * advance the cursor on `accounts.round_robin_last_user_id`, and
 * return the chosen user id (or null if no eligible members).
 *
 * Admins and viewers are excluded from the pool — they can watch
 * the inbox but must never be auto-assigned a conversation. The
 * owner is used only when the account has no agents (a one-person
 * workspace still needs someone to hand to). With advisors, the
 * owner can see and write every thread without keeping the lead.
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

  const pool = await loadAutoAssignPool(db, accountId);
  if (!pool.length) return null;

  const last =
    typeof account?.round_robin_last_user_id === 'string'
      ? (account.round_robin_last_user_id as string)
      : null;
  const idx = last
    ? pool.findIndex((a) => a.user_id === last)
    : -1;
  const next = pool[(idx + 1) % pool.length];
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
 * Round-robin still assigns on inbound; this is a status helper, not
 * a reason to leave the lead unowned.
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

export type RoundRobinClaim = {
  agentId: string | null;
  claimed: boolean;
};

function parseClaimPayload(data: unknown): RoundRobinClaim | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as { agent_id?: unknown; claimed?: unknown };
  const agentId =
    typeof row.agent_id === 'string' && row.agent_id.length > 0
      ? row.agent_id
      : null;
  return { agentId, claimed: row.claimed === true && Boolean(agentId) };
}

/**
 * Assign the next advisor, or keep the one already on the thread.
 * Prefers the atomic RPC so Cloud API + WAHA + AI handoff cannot
 * each advance the cursor on the same new lead.
 */
export async function claimRoundRobinAssignment(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId: string;
    alreadyAssigned?: string | null;
  },
): Promise<RoundRobinClaim> {
  if (await contactBelongsToAccountStaff(db, opts.accountId, opts.contactId)) {
    console.info(
      '[round-robin] skip assign: contact is a staff phone',
      opts.contactId,
    );
    return { agentId: null, claimed: false };
  }

  if (typeof db.rpc === 'function') {
    const { data, error } = await db.rpc('claim_round_robin_assignment', {
      p_account_id: opts.accountId,
      p_conversation_id: opts.conversationId,
      p_contact_id: opts.contactId,
    });
    if (!error) {
      const parsed = parseClaimPayload(data);
      if (parsed) return parsed;
    } else {
      console.warn('[round-robin] claim rpc failed, falling back:', error);
    }
  }

  return claimRoundRobinAssignmentJs(db, opts);
}

async function loadConversationAssignee(
  db: Db,
  conversationId: string,
): Promise<string | null | undefined> {
  const { data, error } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) {
    console.warn('[round-robin] reload assignee failed:', error);
    return undefined;
  }
  if (!data) return undefined;
  const value = data.assigned_agent_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function claimRoundRobinAssignmentJs(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId: string;
    alreadyAssigned?: string | null;
  },
): Promise<RoundRobinClaim> {
  const fromDb = await loadConversationAssignee(db, opts.conversationId);
  const current = fromDb ?? opts.alreadyAssigned ?? null;

  if (current) {
    const inPool = await userIsInAutoAssignPool(
      db,
      opts.accountId,
      current,
    );
    if (inPool) return { agentId: current, claimed: false };
  }

  const { data: account } = await db
    .from('accounts')
    .select('round_robin_enabled')
    .eq('id', opts.accountId)
    .maybeSingle();

  if (!account?.round_robin_enabled) {
    return { agentId: null, claimed: false };
  }

  const agentId = await pickRoundRobinAgent(db, opts.accountId);
  if (!agentId) return { agentId: null, claimed: false };

  const assigned = await assignConversationToAgent(db, {
    accountId: opts.accountId,
    contactId: opts.contactId,
    conversationId: opts.conversationId,
    agentId,
  });
  if (!assigned) return { agentId: null, claimed: false };
  return { agentId, claimed: true };
}

/**
 * If the account has round_robin_enabled and the conversation is new /
 * unassigned, pick the next agent and assign.
 *
 * Runs even while the AI auto-reply bot is qualifying the lead: the
 * advisor owns the thread in the inbox (so restrict-agent-contacts
 * does not hide it), and the bot keeps talking until handoff / Take
 * over. Assignment used to wait until handoff, which left new ads
 * sitting unassigned on the owner's inbox.
 *
 * Also reassigns when the current assignee is not in the auto pool
 * (owner while agents exist, admin, viewer). The proprietor can
 * still open and reply; they must not keep the lead.
 *
 * Never assigns when the contact's phone belongs to a teammate —
 * advisor numbers are inboxes, not leads.
 *
 * Returns the newly chosen agent, or null when the thread already
 * had an advisor (so callers do not fire `conversation_assigned`
 * again). Concurrent inbound + handoff share one cursor advance.
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
  const result = await claimRoundRobinAssignment(db, opts);
  if (!result.agentId) {
    if (opts.alreadyAssigned) {
      await clearConversationAssignment(db, opts);
    }
    return null;
  }
  return result.claimed ? result.agentId : null;
}
