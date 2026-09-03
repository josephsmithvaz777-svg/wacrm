import { DEFAULT_STAFF_ALERT_TEXT } from '@/lib/automations/staff-notify'
import type { BuilderStepInput } from '@/lib/automations/steps-tree'

export const LEAD_HANDOFF_NAME = 'Aviso al asesor por WhatsApp'
export const LEAD_HANDOFF_TRIGGER = 'first_inbound_message' as const

export const DEFAULT_CUSTOMER_MESSAGE =
  'Un asesor te contactará para darte todos los detalles'

export const DEFAULT_ASK_PHONE_MESSAGE =
  '{{greeting}}. ¿Nos puede brindar su número para que un asesor se pueda comunicar con usted y darle toda la información?'

export const LEAD_HANDOFF_MAX_LEN = 2000

export interface LeadHandoffSettings {
  enabled: boolean
  customerMessage: string
  askPhoneMessage: string
  staffMessage: string
}

export const DEFAULT_LEAD_HANDOFF: LeadHandoffSettings = {
  enabled: false,
  customerMessage: DEFAULT_CUSTOMER_MESSAGE,
  askPhoneMessage: DEFAULT_ASK_PHONE_MESSAGE,
  staffMessage: DEFAULT_STAFF_ALERT_TEXT,
}

interface StepLike {
  step_type: string
  step_config?: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function walkSteps(steps: StepLike[], visit: (step: StepLike) => void) {
  for (const step of steps) {
    visit(step)
    if (step.branches?.yes) walkSteps(step.branches.yes, visit)
    if (step.branches?.no) walkSteps(step.branches.no, visit)
  }
}

export function findNotifyStaffStep(steps: StepLike[]): StepLike | null {
  let found: StepLike | null = null
  walkSteps(steps, (step) => {
    if (!found && step.step_type === 'notify_staff') found = step
  })
  return found
}

export function automationLooksLikeLeadHandoff(steps: StepLike[]): boolean {
  return findNotifyStaffStep(steps) != null
}

function findHasPhoneCondition(steps: StepLike[]): StepLike | null {
  let found: StepLike | null = null
  walkSteps(steps, (step) => {
    if (found) return
    if (
      step.step_type === 'condition' &&
      step.step_config?.subject === 'has_phone'
    ) {
      found = step
    }
  })
  return found
}

function firstSendMessage(steps: StepLike[] | undefined): StepLike | null {
  return steps?.find((step) => step.step_type === 'send_message') ?? null
}

export function extractLeadHandoff(
  steps: StepLike[],
  isActive: boolean,
): LeadHandoffSettings {
  const staff = findNotifyStaffStep(steps)
  const condition = findHasPhoneCondition(steps)
  const yes = firstSendMessage(condition?.branches?.yes)
  const no = firstSendMessage(condition?.branches?.no)
  return {
    enabled: isActive,
    staffMessage:
      asText(staff?.step_config?.text).trim() || DEFAULT_STAFF_ALERT_TEXT,
    customerMessage:
      asText(yes?.step_config?.text).trim() || DEFAULT_CUSTOMER_MESSAGE,
    askPhoneMessage:
      asText(no?.step_config?.text).trim() || DEFAULT_ASK_PHONE_MESSAGE,
  }
}

export function buildLeadHandoffSteps(
  settings: LeadHandoffSettings,
): BuilderStepInput[] {
  return [
    {
      step_type: 'notify_staff',
      step_config: {
        notify_owner: false,
        notify_assigned: true,
        text: settings.staffMessage,
      },
    },
    {
      step_type: 'condition',
      step_config: { subject: 'has_phone' },
      branches: {
        yes: [
          {
            step_type: 'send_message',
            step_config: { text: settings.customerMessage },
          },
        ],
        no: [
          {
            step_type: 'send_message',
            step_config: { text: settings.askPhoneMessage },
          },
        ],
      },
    },
  ]
}

export function clampLeadHandoffText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  const next = text || fallback
  return next.slice(0, LEAD_HANDOFF_MAX_LEN)
}

export function parseLeadHandoffBody(
  body: unknown,
): LeadHandoffSettings | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON' }
  }
  const raw = body as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') {
    return { error: "'enabled' must be a boolean" }
  }
  for (const key of ['customerMessage', 'askPhoneMessage', 'staffMessage']) {
    if (typeof raw[key] !== 'string') {
      return { error: `'${key}' must be a string` }
    }
  }
  const settings: LeadHandoffSettings = {
    enabled: raw.enabled,
    customerMessage: clampLeadHandoffText(
      raw.customerMessage,
      DEFAULT_CUSTOMER_MESSAGE,
    ),
    askPhoneMessage: clampLeadHandoffText(
      raw.askPhoneMessage,
      DEFAULT_ASK_PHONE_MESSAGE,
    ),
    staffMessage: clampLeadHandoffText(
      raw.staffMessage,
      DEFAULT_STAFF_ALERT_TEXT,
    ),
  }
  if (settings.enabled) {
    if (!settings.customerMessage) {
      return { error: 'Customer message cannot be empty' }
    }
    if (!settings.staffMessage) {
      return { error: 'Staff message cannot be empty' }
    }
  }
  return settings
}
