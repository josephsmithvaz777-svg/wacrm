import type { SupabaseClient } from '@supabase/supabase-js'
import { localDayKey } from '@/lib/dashboard/date-utils'

/** Inclusive day span an admin can request in one view. */
export const MAX_REPORT_DAYS = 90

const PAGE = 1000
const MAX_ROWS = 20_000

export interface AgentRosterEntry {
  userId: string
  fullName: string
  role: string
}

export interface AssignedMessageRow {
  created_at: string
  assigned_agent_id: string
}

export interface AgentMessageColumn {
  userId: string
  fullName: string
  total: number
  byDay: Record<string, number>
}

export interface AgentMessageReport {
  /** Local calendar days in the requested range, oldest first. */
  days: string[]
  agents: AgentMessageColumn[]
  dayTotals: Record<string, number>
  grandTotal: number
  /** True when the query hit the row cap and the totals may be low. */
  truncated: boolean
}

/**
 * Inclusive list of local YYYY-MM-DD keys from `fromKey` through `toKey`.
 * Returns null when the span is empty, reversed, or longer than
 * `MAX_REPORT_DAYS`.
 */
export function dayKeysBetween(fromKey: string, toKey: string): string[] | null {
  const start = parseDayKey(fromKey)
  const end = parseDayKey(toKey)
  if (!start || !end || start > end) return null

  const keys: string[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    keys.push(localDayKey(cursor))
    if (keys.length > MAX_REPORT_DAYS) return null
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

/**
 * Bucket inbound messages by the agent who currently owns the
 * conversation and by the local day the message arrived.
 *
 * Every current `agent` stays in the result even at zero so an admin
 * can see who received nothing. Anyone else (owner, a former member)
 * appears only when they actually have messages.
 */
export function buildAgentMessageReport(opts: {
  agents: AgentRosterEntry[]
  rows: AssignedMessageRow[]
  dayKeys: string[]
}): AgentMessageReport {
  const daySet = new Set(opts.dayKeys)
  const counts = new Map<string, Map<string, number>>()

  for (const row of opts.rows) {
    if (!row.assigned_agent_id) continue
    const day = localDayKey(row.created_at)
    if (!daySet.has(day)) continue
    let byDay = counts.get(row.assigned_agent_id)
    if (!byDay) {
      byDay = new Map()
      counts.set(row.assigned_agent_id, byDay)
    }
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }

  const known = new Map(opts.agents.map((agent) => [agent.userId, agent]))
  const ids = new Set<string>()
  for (const agent of opts.agents) {
    if (agent.role === 'agent') ids.add(agent.userId)
  }
  for (const id of counts.keys()) ids.add(id)

  const agents: AgentMessageColumn[] = [...ids].map((userId) => {
    const byDayMap = counts.get(userId) ?? new Map<string, number>()
    const byDay: Record<string, number> = {}
    let total = 0
    for (const day of opts.dayKeys) {
      const count = byDayMap.get(day) ?? 0
      byDay[day] = count
      total += count
    }
    return {
      userId,
      fullName: known.get(userId)?.fullName.trim() ?? '',
      total,
      byDay,
    }
  })

  agents.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    const nameA = a.fullName.toLocaleLowerCase() || '\uffff'
    const nameB = b.fullName.toLocaleLowerCase() || '\uffff'
    return nameA.localeCompare(nameB)
  })

  const dayTotals: Record<string, number> = {}
  let grandTotal = 0
  for (const day of opts.dayKeys) {
    const total = agents.reduce((sum, agent) => sum + agent.byDay[day], 0)
    dayTotals[day] = total
    grandTotal += total
  }

  return {
    days: opts.dayKeys,
    agents,
    dayTotals,
    grandTotal,
    truncated: false,
  }
}

type Db = SupabaseClient

interface ProfileRow {
  user_id: string
  full_name: string | null
  account_role: string
}

interface MessageRow {
  created_at: string
  conversations:
    | { assigned_agent_id: string | null }
    | { assigned_agent_id: string | null }[]
    | null
}

function assignedAgentId(row: MessageRow): string | null {
  const conv = row.conversations
  if (!conv) return null
  const record = Array.isArray(conv) ? conv[0] : conv
  return record?.assigned_agent_id ?? null
}

/**
 * Inbound customer messages in conversations that are assigned right
 * now, grouped by agent and by the day the message arrived.
 */
export async function loadAgentMessageReport(
  db: Db,
  fromKey: string,
  toKey: string,
): Promise<AgentMessageReport> {
  const dayKeys = dayKeysBetween(fromKey, toKey)
  if (!dayKeys) {
    throw new Error('Invalid date range')
  }

  const start = parseDayKey(dayKeys[0])
  const end = parseDayKey(dayKeys[dayKeys.length - 1])
  if (!start || !end) throw new Error('Invalid date range')
  const endExclusive = new Date(end)
  endExclusive.setDate(endExclusive.getDate() + 1)

  const { data: profiles, error: profileError } = await db
    .from('profiles')
    .select('user_id, full_name, account_role')
  if (profileError) throw profileError

  const agents: AgentRosterEntry[] = ((profiles ?? []) as ProfileRow[]).map(
    (row) => ({
      userId: row.user_id,
      fullName: row.full_name ?? '',
      role: row.account_role,
    }),
  )

  const rows: AssignedMessageRow[] = []
  let truncated = false

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await db
      .from('messages')
      .select('created_at, conversations!inner(assigned_agent_id)')
      .eq('sender_type', 'customer')
      .gte('created_at', start.toISOString())
      .lt('created_at', endExclusive.toISOString())
      .not('conversations.assigned_agent_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error

    const page = (data ?? []) as MessageRow[]
    for (const row of page) {
      const agentId = assignedAgentId(row)
      if (!agentId) continue
      rows.push({ created_at: row.created_at, assigned_agent_id: agentId })
    }

    if (page.length < PAGE) break
    if (offset + PAGE >= MAX_ROWS) truncated = true
  }

  return {
    ...buildAgentMessageReport({ agents, rows, dayKeys }),
    truncated,
  }
}
