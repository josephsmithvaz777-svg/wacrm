import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { isStaleRunning } from '@/lib/automations/pending-claim'
import { sendDueTaskReminders, ensureTaskDueReminderLoop } from '@/lib/tasks/reminders'
import { sendDueStaffReminders } from '@/lib/tasks/staff-reminder-send'
import { sweepSilentAiConversations } from '@/lib/ai/silence-handoff'
import {
  ensureSheetLeadSyncLoop,
  syncAllEnabledSheetSources,
} from '@/lib/leads/import-sheet-leads'
import { flushMetaCrmEvents } from '@/lib/meta/flush-crm-events'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — requires a shared
 * secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * Call it about once a minute. Each resumed send is capped per account
 * (default 40 in the rolling hour, `accounts.automation_hourly_send_limit`)
 * and the next send for that account waits a random 15–45s. Anything
 * over the cap stays `pending` with a later `run_at`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  ensureTaskDueReminderLoop()
  ensureSheetLeadSyncLoop()
  const reminders = await sendDueTaskReminders(admin)
  const staff = await sendDueStaffReminders(admin)
  const silence = await sweepSilentAiConversations(admin)
  const sheets = await syncAllEnabledSheetSources(admin)
  const meta = await flushMetaCrmEvents(admin)
  await reclaimStaleRunning(admin)

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0, reminders, staff, silence, sheets, meta })
  }

  let processed = 0
  for (const row of due) {
    const claim = await claimPendingRow(admin, row.id as string)
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
      created_at: (row.created_at as string | null) ?? null,
    })
    processed++
  }

  return NextResponse.json({ processed, reminders, staff, silence, sheets, meta })
}

/**
 * A crashed resume leaves the row in `running`. After 5 minutes it
 * goes back to `pending` so the next pass can take it again.
 */
async function reclaimStaleRunning(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<void> {
  const now = Date.now()
  const { data, error } = await admin
    .from('automation_pending_executions')
    .select('id, claimed_at, created_at')
    .eq('status', 'running')
    .limit(100)
  if (error) {
    console.warn('[automations] reclaim running:', error.message)
    return
  }
  const ids = (data ?? [])
    .filter((row) =>
      isStaleRunning(
        {
          claimed_at: (row.claimed_at as string | null) ?? null,
          created_at: (row.created_at as string | null) ?? null,
        },
        now,
      ),
    )
    .map((row) => row.id as string)
  if (ids.length === 0) return
  const { error: updateError } = await admin
    .from('automation_pending_executions')
    .update({ status: 'pending', claimed_at: null })
    .in('id', ids)
    .eq('status', 'running')
  if (!updateError) return
  await admin
    .from('automation_pending_executions')
    .update({ status: 'pending' })
    .in('id', ids)
    .eq('status', 'running')
}

async function claimPendingRow(
  admin: ReturnType<typeof supabaseAdmin>,
  id: string,
): Promise<{ id: string } | null> {
  const claimedAt = new Date().toISOString()
  const first = await admin
    .from('automation_pending_executions')
    .update({ status: 'running', claimed_at: claimedAt })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!first.error) return (first.data as { id: string } | null) ?? null
  const second = await admin
    .from('automation_pending_executions')
    .update({ status: 'running' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  return (second.data as { id: string } | null) ?? null
}
