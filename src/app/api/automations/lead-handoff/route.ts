import { NextResponse } from 'next/server'

import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  DEFAULT_LEAD_HANDOFF,
  LEAD_HANDOFF_NAME,
  LEAD_HANDOFF_TRIGGER,
  automationLooksLikeLeadHandoff,
  buildLeadHandoffSteps,
  extractLeadHandoff,
  parseLeadHandoffBody,
  type LeadHandoffSettings,
} from '@/lib/automations/lead-handoff'
import { loadStepsTree, replaceSteps } from '@/lib/automations/steps-tree'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const found = await findLeadHandoff(ctx.accountId)
    if (!found) {
      return NextResponse.json({
        settings: DEFAULT_LEAD_HANDOFF,
        automationId: null,
      })
    }
    return NextResponse.json({
      settings: extractLeadHandoff(found.steps, found.isActive),
      automationId: found.id,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(
      `admin:lead-handoff:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseLeadHandoffBody(await request.json().catch(() => null))
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const automationId = await saveLeadHandoff({
      accountId: ctx.accountId,
      userId: ctx.userId,
      settings: parsed,
    })
    return NextResponse.json({ ok: true, automationId, settings: parsed })
  } catch (err) {
    return toErrorResponse(err)
  }
}

async function findLeadHandoff(accountId: string): Promise<{
  id: string
  isActive: boolean
  steps: Awaited<ReturnType<typeof loadStepsTree>>
} | null> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('automations')
    .select('id, is_active, name, created_at')
    .eq('account_id', accountId)
    .eq('trigger_type', LEAD_HANDOFF_TRIGGER)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const matches: {
    id: string
    isActive: boolean
    name: string
    steps: Awaited<ReturnType<typeof loadStepsTree>>
  }[] = []
  for (const row of data ?? []) {
    const steps = await loadStepsTree(row.id as string)
    if (!automationLooksLikeLeadHandoff(steps)) continue
    matches.push({
      id: row.id as string,
      isActive: Boolean(row.is_active),
      name: (row.name as string) ?? '',
      steps,
    })
  }
  if (matches.length === 0) return null
  return (
    matches.find((row) => row.name === LEAD_HANDOFF_NAME) ??
    matches.find((row) => row.isActive) ??
    matches[0]
  )
}

async function saveLeadHandoff(params: {
  accountId: string
  userId: string
  settings: LeadHandoffSettings
}): Promise<string> {
  const admin = supabaseAdmin()
  const existing = await findLeadHandoff(params.accountId)
  const steps = buildLeadHandoffSteps(params.settings)

  if (!existing) {
    const { data, error } = await admin
      .from('automations')
      .insert({
        user_id: params.userId,
        account_id: params.accountId,
        name: LEAD_HANDOFF_NAME,
        description:
          'Avisa al asesor por WhatsApp y responde al lead en el primer mensaje.',
        trigger_type: LEAD_HANDOFF_TRIGGER,
        trigger_config: {},
        is_active: params.settings.enabled,
      })
      .select('id')
      .single()
    if (error || !data?.id) {
      throw new Error(error?.message || 'Could not create lead-handoff automation')
    }
    const insertErr = await replaceSteps(data.id as string, steps)
    if (insertErr) throw new Error(insertErr)
    return data.id as string
  }

  const { error: updErr } = await admin
    .from('automations')
    .update({
      is_active: params.settings.enabled,
      name: LEAD_HANDOFF_NAME,
    })
    .eq('id', existing.id)
  if (updErr) throw new Error(updErr.message)

  const stepsErr = await replaceSteps(existing.id, steps)
  if (stepsErr) throw new Error(stepsErr)
  return existing.id
}
