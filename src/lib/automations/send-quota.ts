import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_HOURLY_SEND_LIMIT = 40
export const MIN_HOURLY_SEND_LIMIT = 1
export const MAX_HOURLY_SEND_LIMIT = 500

/** Customer-facing sends. Staff alerts are not part of the warming cap. */
export const PACED_SEND_STEPS = new Set([
  'send_message',
  'send_file',
  'send_buttons',
  'send_list',
  'send_template',
])

export function isPacedSendStep(stepType: string): boolean {
  return PACED_SEND_STEPS.has(stepType)
}

export function clampHourlySendLimit(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) return null
  if (n < MIN_HOURLY_SEND_LIMIT || n > MAX_HOURLY_SEND_LIMIT) return null
  return n
}

/**
 * First-day schedule. Contact `index` is placed in hour
 * `floor(index / perHour)` and spaced evenly inside that hour so a
 * 40/hour cap does not dump every lead in the same minute.
 */
export function staggerRunAt(
  index: number,
  perHour: number,
  nowMs: number,
  jitterMs = 0,
): string {
  const limit = Math.max(1, Math.floor(perHour) || DEFAULT_HOURLY_SEND_LIMIT)
  const safeIndex = Math.max(0, Math.floor(index))
  const hour = Math.floor(safeIndex / limit)
  const slot = safeIndex % limit
  const slotMs = Math.floor(3_600_000 / limit)
  const jitter = Math.max(0, Math.floor(jitterMs))
  return new Date(nowMs + hour * 3_600_000 + slot * slotMs + jitter).toISOString()
}

export interface SendSlot {
  /** True when this send may go out now. The row was recorded. */
  claimed: boolean
  /** When claimed is false, the pending row should run again at this time. */
  retryAt: string | null
  /**
   * Row to delete if WhatsApp rejects the send. Null when the slot was
   * not recorded (cap miss, or migration 078 is not applied yet).
   */
  eventId: string | null
  /** Migration not applied yet — caller should send, not block the queue. */
  unavailable?: boolean
}

function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    message.includes('claim_automation_send_slot') ||
    message.includes('release_automation_send_slot')
  )
}

/**
 * Reserve one send in the account's rolling hour, or return when to
 * retry. A missing function (migration 077 not applied) does not block
 * sends — existing automations keep working.
 */
export async function claimAutomationSendSlot(
  db: SupabaseClient,
  accountId: string,
): Promise<SendSlot> {
  const { data, error } = await db.rpc('claim_automation_send_slot', {
    p_account_id: accountId,
  })
  if (error) {
    if (isMissingRpc(error)) {
      console.warn(
        '[automations] claim_automation_send_slot is missing — apply migration 077. Sends are not capped.',
      )
      return { claimed: true, retryAt: null, eventId: null, unavailable: true }
    }
    console.error('[automations] claim send slot:', error.message)
    return {
      claimed: false,
      retryAt: new Date(Date.now() + 60_000).toISOString(),
      eventId: null,
    }
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { claimed?: boolean; retry_at?: string | null; event_id?: string | null }
    | null
    | undefined
  if (row?.claimed) {
    return {
      claimed: true,
      retryAt: null,
      eventId: typeof row.event_id === 'string' ? row.event_id : null,
    }
  }
  const retryAt =
    typeof row?.retry_at === 'string' && row.retry_at
      ? row.retry_at
      : new Date(Date.now() + 60_000).toISOString()
  return { claimed: false, retryAt, eventId: null }
}

/** Give the hourly slot back when the provider call did not succeed. */
export async function releaseAutomationSendSlot(
  db: SupabaseClient,
  eventId: string | null,
): Promise<void> {
  if (!eventId) return
  const { error } = await db.rpc('release_automation_send_slot', {
    p_event_id: eventId,
  })
  if (error && !isMissingRpc(error)) {
    console.warn('[automations] release send slot:', error.message)
  }
}
