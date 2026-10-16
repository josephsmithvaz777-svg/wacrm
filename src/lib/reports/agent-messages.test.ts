import { describe, expect, it } from 'vitest'
import {
  MAX_REPORT_DAYS,
  buildAgentMessageReport,
  dayKeysBetween,
} from './agent-messages'

/** Noon on a calendar day in the machine timezone, as an ISO timestamp. */
function atLocalNoon(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12, 0, 0).toISOString()
}

describe('dayKeysBetween', () => {
  it('includes both ends', () => {
    expect(dayKeysBetween('2026-10-14', '2026-10-16')).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ])
  })

  it('rejects a reversed range and an oversized span', () => {
    expect(dayKeysBetween('2026-10-16', '2026-10-14')).toBeNull()
    expect(dayKeysBetween('2026-01-01', '2026-05-01')).toBeNull()
    expect(dayKeysBetween('2026-01-01', '2026-01-01')).toHaveLength(1)
    expect(MAX_REPORT_DAYS).toBe(90)
  })
})

describe('buildAgentMessageReport', () => {
  const agents = [
    { userId: 'agent-a', fullName: 'Ana', role: 'agent' },
    { userId: 'agent-b', fullName: 'Luis', role: 'agent' },
    { userId: 'admin-1', fullName: 'Admin', role: 'admin' },
  ]
  const dayKeys = ['2026-10-15', '2026-10-16']

  it('counts inbound messages per agent and local day', () => {
    const report = buildAgentMessageReport({
      agents,
      dayKeys,
      rows: [
        { created_at: atLocalNoon('2026-10-16'), assigned_agent_id: 'agent-a' },
        { created_at: atLocalNoon('2026-10-16'), assigned_agent_id: 'agent-a' },
        { created_at: atLocalNoon('2026-10-15'), assigned_agent_id: 'agent-b' },
        { created_at: atLocalNoon('2026-10-16'), assigned_agent_id: 'owner-1' },
      ],
    })

    const ana = report.agents.find((agent) => agent.userId === 'agent-a')
    const luis = report.agents.find((agent) => agent.userId === 'agent-b')
    const owner = report.agents.find((agent) => agent.userId === 'owner-1')

    expect(ana?.byDay['2026-10-16']).toBe(2)
    expect(luis?.total).toBe(1)
    expect(owner?.total).toBe(1)
    expect(report.agents.some((agent) => agent.userId === 'admin-1')).toBe(false)
    expect(report.grandTotal).toBe(
      report.agents.reduce((sum, agent) => sum + agent.total, 0),
    )
    expect(report.dayTotals['2026-10-15']).toBe(1)
  })

  it('keeps agents with zero messages', () => {
    const report = buildAgentMessageReport({
      agents,
      dayKeys,
      rows: [],
    })

    expect(report.agents.map((agent) => agent.userId).sort()).toEqual([
      'agent-a',
      'agent-b',
    ])
    expect(report.grandTotal).toBe(0)
  })

  it('ignores messages outside the requested days', () => {
    const report = buildAgentMessageReport({
      agents,
      dayKeys,
      rows: [
        { created_at: atLocalNoon('2026-01-01'), assigned_agent_id: 'agent-a' },
      ],
    })

    expect(report.agents.find((agent) => agent.userId === 'agent-a')?.total).toBe(0)
  })
})
