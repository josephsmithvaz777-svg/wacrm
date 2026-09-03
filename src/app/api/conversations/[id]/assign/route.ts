import { NextResponse } from 'next/server';

import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { assignConversationToAgent } from '@/lib/assignments/round-robin';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';

// POST /api/conversations/[id]/assign — { agent_id: string | null }
//
// Assigns (or unassigns) the thread and fires conversation_assigned
// automations so the advisor can get a WhatsApp alert. Inbox used to
// write conversations.assigned_agent_id from the browser, which never
// ran those automations.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: conversationId } = await params;
    const { supabase, accountId, role } = await getCurrentAccount();

    if (!hasMinRole(role, 'agent')) {
      return NextResponse.json(
        { error: 'Solo un asesor puede asignar conversaciones' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const agentId =
      body && typeof body.agent_id === 'string' && body.agent_id
        ? body.agent_id
        : null;

    const { data: conversation, error } = await supabase
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const contactId = conversation.contact_id as string | null;
    const previousAgentId =
      (conversation.assigned_agent_id as string | null | undefined) ?? null;

    if (!agentId) {
      const admin = supabaseAdmin();
      await admin
        .from('conversations')
        .update({ assigned_agent_id: null })
        .eq('id', conversationId)
        .eq('account_id', accountId);
      if (contactId) {
        await admin
          .from('contacts')
          .update({
            assigned_to: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactId)
          .eq('account_id', accountId);
      }
      return NextResponse.json({ assigned_agent_id: null });
    }

    if (!contactId) {
      return NextResponse.json(
        { error: 'Conversation has no contact' },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();
    await assignConversationToAgent(admin, {
      accountId,
      contactId,
      conversationId,
      agentId,
    });

    if (agentId !== previousAgentId) {
      const { data: lastInbound } = await admin
        .from('messages')
        .select('content_text')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await runAutomationsForTrigger({
        accountId,
        triggerType: 'conversation_assigned',
        contactId,
        context: {
          conversation_id: conversationId,
          agent_id: agentId,
          message_text: String(lastInbound?.content_text ?? ''),
        },
      });
    }

    return NextResponse.json({ assigned_agent_id: agentId });
  } catch (error) {
    console.error('Error in conversations assign POST:', error);
    return toErrorResponse(error);
  }
}
