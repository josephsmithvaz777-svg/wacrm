// Centralised date helpers for the dashboard so every chart / card
// agrees on what "today", "day boundary", and "day of week" mean.
// All boundaries are computed in the user's LOCAL timezone — which is
// what a business user intuitively expects when they say "today".

export function startOfLocalDay(d: Date = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function daysAgoStart(days: number): Date {
  const out = startOfLocalDay()
  out.setDate(out.getDate() - days)
  return out
}

/** Date-only key (YYYY-MM-DD) for bucketing rows by local calendar day. */
export function localDayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive list of local-day keys spanning the last `n` days, in
 * chronological order. Useful for seeding chart buckets so days with
 * zero activity still render a 0-point in the line.
 */
export function lastNDayKeys(n: number): string[] {
  const keys: string[] = []
  const start = daysAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    keys.push(localDayKey(d))
  }
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday. JavaScript's native
 * getDay() uses 0 = Sunday which is awkward for most business charts.
 */
export function mondayIndex(d: Date): number {
  const jsDow = d.getDay() // 0..6 with Sunday=0
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function startOfLocalMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

export function monthsAgoStart(months: number, d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() - months, 1, 0, 0, 0, 0)
}

/** YYYY-MM key for bucketing rows by local calendar month. */
export function localMonthKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Inclusive list of local-month keys spanning the last `n` months,
 * chronological, ending this month.
 */
export function lastNMonthKeys(n: number): string[] {
  const keys: string[] = []
  const start = monthsAgoStart(n - 1)
  for (let i = 0; i < n; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    keys.push(localMonthKey(d))
  }
  return keys
}

export function bucketByMonth(
  timestamps: string[],
  monthKeys: string[],
): { month: string; leads: number }[] {
  const buckets = new Map<string, number>()
  for (const key of monthKeys) buckets.set(key, 0)
  for (const ts of timestamps) {
    const key = localMonthKey(ts)
    if (!buckets.has(key)) continue
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return monthKeys.map((month) => ({ month, leads: buckets.get(month) ?? 0 }))
}

/** Compact duration for KPI cards (1s / 4.2m / 1.5h). */
export function formatMinutes(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}
