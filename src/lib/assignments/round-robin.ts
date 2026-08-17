// ============================================================
// Round-robin agent assignment
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Pick the next agent/admin in stable user_id order for an account,
 * advance the cursor on `accounts.round_robin_last_user_id`, and
 * return the chosen user id (or null if no eligible members).
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
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['agent', 'admin'])
    .order('user_id', { ascending: true });

  if (error || !agents?.length) {
    if (error) console.warn('[round-robin] load agents failed:', error);
    return null;
  }

  const last =
    typeof account?.round_robin_last_user_id === 'string'
      ? (account.round_robin_last_user_id as string)
      : null;
  const idx = last
    ? (agents as { user_id: string }[]).findIndex((a) => a.user_id === last)
    : -1;
  const next = (agents as { user_id: string }[])[
    (idx + 1) % agents.length
  ];
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

/** Assign conversation + contact to an agent (best-effort contact sync). */
export async function assignConversationToAgent(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId?: string | null;
    agentId: string;
  },
): Promise<void> {
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
}

/**
 * If the account has round_robin_enabled and the conversation is new /
 * unassigned, pick the next agent and assign.
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
  if (opts.alreadyAssigned) return null;

  const { data: account } = await db
    .from('accounts')
    .select('round_robin_enabled')
    .eq('id', opts.accountId)
    .maybeSingle();

  if (!account?.round_robin_enabled) return null;

  const agentId = await pickRoundRobinAgent(db, opts.accountId);
  if (!agentId) return null;

  await assignConversationToAgent(db, {
    accountId: opts.accountId,
    contactId: opts.contactId,
    conversationId: opts.conversationId,
    agentId,
  });
  return agentId;
}
