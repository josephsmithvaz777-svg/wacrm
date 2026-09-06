// Put an inbound WhatsApp contact onto the sales board.
//
// Every genuine customer message (not a webhook replay) either creates
// an open deal in the pipeline's first stage ("New Lead") or moves the
// existing open deal back there so the lead shows up in Nuevos leads.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function pickNewLeadStageId(
  stages: { id: string; position: number }[],
): string | null {
  if (!stages.length) return null;
  return [...stages].sort((a, b) => a.position - b.position)[0]?.id ?? null;
}

export function dealTitleForContact(contact: {
  name?: string | null;
  phone?: string | null;
}): string {
  return (contact.name ?? '').trim() || contact.phone || 'Lead';
}

export function resolveInboundDealAction(opts: {
  openDeal: { id: string; stage_id: string } | null;
  newLeadStageId: string;
}): 'create' | 'move' | 'unchanged' {
  if (!opts.openDeal) return 'create';
  if (opts.openDeal.stage_id === opts.newLeadStageId) return 'unchanged';
  return 'move';
}

/**
 * Best-effort: never throws. A missing pipeline or a write error must
 * not fail the WhatsApp webhook.
 */
export async function ensureInboundLeadInFunnel(
  db: Db,
  opts: {
    accountId: string;
    contactId: string;
    conversationId?: string | null;
    assignedAgentId?: string | null;
    actorUserId: string;
  },
): Promise<'created' | 'moved' | 'unchanged' | 'skipped'> {
  try {
    const { data: pipeline } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', opts.accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!pipeline?.id) return 'skipped';

    const { data: stages } = await db
      .from('pipeline_stages')
      .select('id, position')
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true });
    const newLeadStageId = pickNewLeadStageId(
      (stages as { id: string; position: number }[]) ?? [],
    );
    if (!newLeadStageId) return 'skipped';

    const { data: openDeal } = await db
      .from('deals')
      .select('id, stage_id')
      .eq('account_id', opts.accountId)
      .eq('contact_id', opts.contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const action = resolveInboundDealAction({
      openDeal: openDeal
        ? { id: openDeal.id as string, stage_id: openDeal.stage_id as string }
        : null,
      newLeadStageId,
    });

    if (action === 'unchanged') return 'unchanged';

    if (action === 'move' && openDeal?.id) {
      const { error } = await db
        .from('deals')
        .update({
          stage_id: newLeadStageId,
          pipeline_id: pipeline.id,
          conversation_id: opts.conversationId ?? null,
          assigned_to: opts.assignedAgentId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', openDeal.id)
        .eq('account_id', opts.accountId);
      if (error) {
        console.warn('[inbound-deal] move failed:', error);
        return 'skipped';
      }
      return 'moved';
    }

    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', opts.contactId)
      .maybeSingle();
    const { data: account } = await db
      .from('accounts')
      .select('default_currency')
      .eq('id', opts.accountId)
      .maybeSingle();

    const { error } = await db.from('deals').insert({
      account_id: opts.accountId,
      user_id: opts.actorUserId,
      pipeline_id: pipeline.id,
      stage_id: newLeadStageId,
      contact_id: opts.contactId,
      conversation_id: opts.conversationId ?? null,
      assigned_to: opts.assignedAgentId ?? null,
      title: dealTitleForContact(contact ?? {}),
      value: 0,
      currency: account?.default_currency ?? 'USD',
      status: 'open',
    });
    if (error) {
      console.warn('[inbound-deal] create failed:', error);
      return 'skipped';
    }
    return 'created';
  } catch (err) {
    console.warn('[inbound-deal] ensure failed:', err);
    return 'skipped';
  }
}
