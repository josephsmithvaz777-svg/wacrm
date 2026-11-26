/** A `running` row older than this is handed back to the cron queue. */
export const STALE_RUNNING_MS = 5 * 60 * 1000

/**
 * True when a claimed row has been `running` longer than the stale window.
 * `claimed_at` is when the cron took it. Rows from before that column
 * fall back to `created_at`.
 */
export function isStaleRunning(
  row: { claimed_at?: string | null; created_at?: string | null },
  nowMs: number,
  staleMs = STALE_RUNNING_MS,
): boolean {
  const stamp = row.claimed_at ?? row.created_at
  if (!stamp) return false
  const at = Date.parse(stamp)
  if (Number.isNaN(at)) return false
  return nowMs - at > staleMs
}
