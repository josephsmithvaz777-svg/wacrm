import { NextResponse } from 'next/server';
import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { findOrCreateConversation } from '@/lib/conversations/find-or-create';

// POST /api/conversations/resolve — { contact_id } → { conversation_id }
//
// Opening an existing thread is a read. Anyone who can see the contact
// (viewer+) may deep-link into it. Creating a thread is a write, so
// that path still requires agent+.
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, role } = await getCurrentAccount();

    const body = await request.json().catch(() => ({}));
    const contactId =
      body && typeof body.contact_id === 'string' ? body.contact_id : '';
    if (!contactId) {
      return NextResponse.json(
        { error: 'contact_id is required' },
        { status: 400 },
      );
    }

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json({ conversation_id: existing.id });
    }

    if (!hasMinRole(role, 'agent')) {
      throw new ForbiddenError(
        'Solo un asesor puede iniciar un chat nuevo con este contacto',
      );
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
