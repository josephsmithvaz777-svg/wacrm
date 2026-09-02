import { describe, expect, it } from 'vitest';

import {
  fillAutomationPlaceholders,
  greetingForInstant,
} from './template-vars';

describe('greetingForInstant', () => {
  it('uses Lima morning / afternoon / night windows', () => {
    // 2026-09-02 10:00-05:00 = 15:00 UTC
    expect(
      greetingForInstant(new Date('2026-09-02T15:00:00.000Z')),
    ).toBe('Buenos días');
    expect(
      greetingForInstant(new Date('2026-09-02T18:00:00.000Z')),
    ).toBe('Buenas tardes');
    expect(
      greetingForInstant(new Date('2026-09-03T02:00:00.000Z')),
    ).toBe('Buenas noches');
  });
});

describe('fillAutomationPlaceholders', () => {
  it('fills dotted and underscored keys', () => {
    expect(
      fillAutomationPlaceholders(
        '{{greeting}}, el asesor {{agent.name}} ({{contact_phone}})',
        {
          greeting: 'Buenos días',
          'agent.name': 'Isaac',
          contact_phone: '51999111222',
        },
      ),
    ).toBe('Buenos días, el asesor Isaac (51999111222)');
  });
});
