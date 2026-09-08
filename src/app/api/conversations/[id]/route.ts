import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE /api/conversations/[id]  (admin+)
 *
 * Remove a thread from the inbox. Messages and assignment
 * notifications go with it. The contact and any deals stay
 * (deals.conversation_id is cleared). A later inbound from the
 * same number opens a fresh conversation.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { accountId } = await requireRole('admin')
    const { id: conversationId } = await params
    const db = supabaseAdmin()

    const { data: conversation, error } = await db
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[conversations] lookup failed:', error)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { error: dealErr } = await db
      .from('deals')
      .update({ conversation_id: null })
      .eq('conversation_id', conversationId)
      .eq('account_id', accountId)
    if (dealErr) {
      console.warn('[conversations] detach deals failed:', dealErr)
    }

    const { error: delErr } = await db
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (delErr) {
      console.error('[conversations] delete failed:', delErr)
      return NextResponse.json(
        { error: 'Failed to delete conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
