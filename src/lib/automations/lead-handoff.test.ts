import { describe, expect, it } from 'vitest'

import { DEFAULT_STAFF_ALERT_TEXT } from '@/lib/automations/staff-notify'
import {
  DEFAULT_CUSTOMER_MESSAGE,
  automationLooksLikeLeadHandoff,
  buildLeadHandoffSteps,
  extractLeadHandoff,
  parseLeadHandoffBody,
} from '@/lib/automations/lead-handoff'

const LIVE_STEPS = [
  {
    step_type: 'notify_staff',
    step_config: {
      text: 'Nuevo lead {{contact_name}}',
      notify_owner: false,
      notify_assigned: true,
    },
    branches: { yes: [], no: [] },
  },
  {
    step_type: 'condition',
    step_config: { subject: 'has_phone' },
    branches: {
      yes: [],
      no: [
        {
          step_type: 'send_message',
          step_config: { text: '¿Nos da su número?' },
          branches: { yes: [], no: [] },
        },
      ],
    },
  },
]

describe('extractLeadHandoff', () => {
  it('reads staff + ask-phone texts and fills the missing customer message', () => {
    expect(extractLeadHandoff(LIVE_STEPS, true)).toEqual({
      enabled: true,
      staffMessage: 'Nuevo lead {{contact_name}}',
      customerMessage: DEFAULT_CUSTOMER_MESSAGE,
      askPhoneMessage: '¿Nos da su número?',
    })
  })

  it('reads the yes-branch customer message when present', () => {
    const steps = buildLeadHandoffSteps({
      enabled: true,
      customerMessage: 'Un asesor te contactará para darte todos los detalles',
      askPhoneMessage: 'Pasa tu número',
      staffMessage: 'Lead: {{contact_phone}}',
    })
    expect(extractLeadHandoff(steps, false)).toMatchObject({
      enabled: false,
      customerMessage: 'Un asesor te contactará para darte todos los detalles',
      askPhoneMessage: 'Pasa tu número',
      staffMessage: 'Lead: {{contact_phone}}',
    })
  })
})

describe('buildLeadHandoffSteps', () => {
  it('notifies the assigned agent and greets the lead when they have a number', () => {
    const steps = buildLeadHandoffSteps({
      enabled: true,
      customerMessage: 'Hola cliente',
      askPhoneMessage: 'Pide número',
      staffMessage: 'Hola asesor',
    })
    expect(steps[0]).toMatchObject({
      step_type: 'notify_staff',
      step_config: {
        notify_owner: false,
        notify_assigned: true,
        text: 'Hola asesor',
      },
    })
    expect(steps[1]?.branches?.yes?.[0]?.step_config).toEqual({
      text: 'Hola cliente',
    })
    expect(steps[1]?.branches?.no?.[0]?.step_config).toEqual({
      text: 'Pide número',
    })
  })
})

describe('automationLooksLikeLeadHandoff', () => {
  it('matches automations that notify staff', () => {
    expect(automationLooksLikeLeadHandoff(LIVE_STEPS)).toBe(true)
    expect(
      automationLooksLikeLeadHandoff([
        { step_type: 'send_message', step_config: { text: 'hi' } },
      ]),
    ).toBe(false)
  })
})

describe('parseLeadHandoffBody', () => {
  it('rejects missing fields', () => {
    expect(parseLeadHandoffBody({ enabled: true })).toEqual({
      error: "'customerMessage' must be a string",
    })
  })

  it('falls back to defaults when texts are blank', () => {
    expect(
      parseLeadHandoffBody({
        enabled: false,
        customerMessage: '   ',
        askPhoneMessage: '',
        staffMessage: '',
      }),
    ).toMatchObject({
      enabled: false,
      customerMessage: DEFAULT_CUSTOMER_MESSAGE,
      staffMessage: DEFAULT_STAFF_ALERT_TEXT,
    })
  })
})
