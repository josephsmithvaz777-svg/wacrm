import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { findOrCreateConversation } from '@/lib/conversations/find-or-create';

// POST /api/conversations/resolve — { contact_id } → { conversation_id }
//
// Backs the "open chat" action in the Contacts UI, which needs a
// conversation id to deep-link into the inbox (`/inbox?c=<id>`). A
// contact added by hand — or one that never wrote in — has no thread
// yet, so it is created on demand through the same find-or-create the
// send route uses, keeping one thread per contact.
//
// Creating nothing but an empty thread is deliberate: the agent lands in
// the inbox and types there, so no message is sent by opening a chat.
export async function POST(request: Request) {
  try {
    // 'agent' matches `canSendMessages` and the conversations_insert RLS
    // policy — a viewer must not be able to open (and thereby create) a
    // thread.
    const { supabase, accountId, userId } = await requireRole('agent');

    const body = await request.json().catch(() => ({}));
    const contactId =
      body && typeof body.contact_id === 'string' ? body.contact_id : '';
    if (!contactId) {
      return NextResponse.json(
        { error: 'contact_id is required' },
        { status: 400 },
      );
    }

    // Scope to the caller's account before touching conversations, so a
    // guessed id can't open a thread against another account's contact.
    // Under agent contact restrictions RLS narrows this further to the
    // contacts this agent may read.
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const conversationId = await findOrCreateConversation(
      supabase,
      accountId,
      userId,
      contactId,
    );
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Failed to open a conversation for this contact' },
        { status: 500 },
      );
    }

    return NextResponse.json({ conversation_id: conversationId });
  } catch (error) {
    console.error('Error in conversations resolve POST:', error);
    return toErrorResponse(error);
  }
}
