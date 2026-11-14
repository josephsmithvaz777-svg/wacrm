import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { enrollContactsInWarming, MAX_WARMING_ENROLL } from '@/lib/automations/enroll'
import { createdAtRange } from '@/lib/contacts/date-range'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface EnrollFilters {
  search?: string
  tag_ids?: string[]
  assigned_to?: string[]
  include_unassigned?: boolean
  created_from?: string
  created_to?: string
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/**
 * Contacts the caller can already see with the list filters. Uses the
 * user-scoped client so RLS, not the service role, decides membership.
 */
async function collectFilteredIds(
  supabase: SupabaseClient,
  filters: EnrollFilters,
): Promise<{ ids: string[]; truncated: boolean }> {
  const range = createdAtRange(filters.created_from, filters.created_to)
  if (range.invalid) {
    throw new Error('invalid_date_range')
  }
  const search = filters.search?.trim() || null
  const tagIds = stringList(filters.tag_ids)
  const assigned = stringList(filters.assigned_to)
  const includeUnassigned = filters.include_unassigned === true
  const useRpc = tagIds.length > 0 || assigned.length > 0 || includeUnassigned
  const ids: string[] = []
  const pageSize = 500

  for (let offset = 0; ids.length < MAX_WARMING_ENROLL; offset += pageSize) {
    const limit = Math.min(pageSize, MAX_WARMING_ENROLL - ids.length)
    if (useRpc) {
      const args: Record<string, unknown> = {
        p_tag_ids: tagIds.length ? tagIds : null,
        p_assigned_to: assigned.length ? assigned : null,
        p_include_unassigned: includeUnassigned,
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      }
      if (range.fromIso) args.p_created_from = range.fromIso
      if (range.toIsoExclusive) args.p_created_to = range.toIsoExclusive
      const { data, error } = await supabase.rpc('filter_contacts', args)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as { contact?: { id?: string } }[]
      if (rows.length === 0) break
      for (const row of rows) {
        if (row.contact?.id) ids.push(row.contact.id)
      }
      if (rows.length < limit) break
    } else {
      let query = supabase
        .from('contacts')
        .select('id')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (range.fromIso) query = query.gte('created_at', range.fromIso)
      if (range.toIsoExclusive) query = query.lt('created_at', range.toIsoExclusive)
      if (search) {
        const like = `%${search}%`
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      }
      const { data, error } = await query
      if (error) throw new Error(error.message)
      const rows = data ?? []
      for (const row of rows) {
        if (typeof row.id === 'string') ids.push(row.id)
      }
      if (rows.length < limit) break
    }
  }

  return { ids: ids.slice(0, MAX_WARMING_ENROLL), truncated: ids.length >= MAX_WARMING_ENROLL }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`warming-enroll:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const automationId = typeof body?.automation_id === 'string' ? body.automation_id : ''
    if (!automationId) {
      return NextResponse.json({ error: 'automation_id is required' }, { status: 400 })
    }

    let ids: string[] = []
    let truncated = false
    if (body?.scope === 'filters') {
      const collected = await collectFilteredIds(supabase, (body.filters ?? {}) as EnrollFilters)
      ids = collected.ids
      truncated = collected.truncated
    } else {
      ids = stringList(body?.contact_ids).slice(0, MAX_WARMING_ENROLL)
      truncated = stringList(body?.contact_ids).length > MAX_WARMING_ENROLL
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: 'no_contacts' }, { status: 400 })
    }

    const result = await enrollContactsInWarming(supabaseAdmin(), {
      accountId,
      automationId,
      contactIds: ids,
    })
    return NextResponse.json({ ...result, truncated })
  } catch (err) {
    if (err instanceof Error && err.message === 'invalid_date_range') {
      return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 })
    }
    if (err instanceof Error && err.message === 'automation not found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (err instanceof Error && err.message === 'automation is not active') {
      return NextResponse.json({ error: 'inactive' }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
