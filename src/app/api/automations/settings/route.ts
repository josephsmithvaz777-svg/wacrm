import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { clampHourlySendLimit, DEFAULT_HOURLY_SEND_LIMIT } from '@/lib/automations/send-quota'

/** Read the account's automation send cap. Any member can see it. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data, error } = await supabase
      .from('accounts')
      .select('automation_hourly_send_limit')
      .eq('id', accountId)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const raw = data?.automation_hourly_send_limit
    return NextResponse.json({
      hourly_send_limit:
        typeof raw === 'number' && raw > 0 ? raw : DEFAULT_HOURLY_SEND_LIMIT,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Admin sets how many automation messages the cron may send per hour. */
export async function PATCH(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const limit = clampHourlySendLimit(body?.hourly_send_limit)
    if (limit === null) {
      return NextResponse.json(
        { error: 'hourly_send_limit must be an integer from 1 to 500' },
        { status: 400 },
      )
    }
    const { error } = await supabaseAdmin()
      .from('accounts')
      .update({ automation_hourly_send_limit: limit })
      .eq('id', accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ hourly_send_limit: limit })
  } catch (err) {
    return toErrorResponse(err)
  }
}
