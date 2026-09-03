import { describe, expect, it } from 'vitest';

import {
  isUsableStaffPhone,
  pickStaffNotifyTargets,
  renderStaffAlert,
  staffAlertChannel,
  staffPhoneDigits,
} from './staff-notify';

describe('staffPhoneDigits / isUsableStaffPhone', () => {
  it('keeps only digits', () => {
    expect(staffPhoneDigits('+51 999 111 222')).toBe('51999111222');
  });

  it('rejects empty, short, and LID-length values', () => {
    expect(isUsableStaffPhone(null)).toBe(false);
    expect(isUsableStaffPhone('123')).toBe(false);
    expect(isUsableStaffPhone('38323993190459')).toBe(false);
    expect(isUsableStaffPhone('+51999111222')).toBe(true);
  });
});

describe('renderStaffAlert', () => {
  it('fills known placeholders and drops unknown ones', () => {
    expect(
      renderStaffAlert('Hola {{contact_name}}: {{message.text}} {{missing}}', {
        contact_name: 'Ana',
        'message.text': 'info',
      }),
    ).toBe('Hola Ana: info ');
  });
});

describe('pickStaffNotifyTargets', () => {
  it('drops the customer phone so a staff reply cannot loop', () => {
    expect(
      pickStaffNotifyTargets(
        [
          {
            userId: 'owner',
            role: 'owner',
            phone: '+51999111222',
            name: 'Joseph',
          },
        ],
        '51999111222',
      ),
    ).toEqual([]);
  });

  it('dedupes when the owner is also the assigned agent', () => {
    const targets = pickStaffNotifyTargets(
      [
        {
          userId: 'u1',
          role: 'owner',
          phone: '51999111222',
          name: 'Joseph',
        },
        {
          userId: 'u1',
          role: 'assigned_agent',
          phone: '+51 999 111 222',
          name: 'Joseph',
        },
      ],
      '51988000000',
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.role).toBe('owner');
    expect(targets[0]?.phone).toBe('51999111222');
  });

  it('keeps owner and agent when the numbers differ', () => {
    const targets = pickStaffNotifyTargets(
      [
        {
          userId: 'owner',
          role: 'owner',
          phone: '51911111111',
          name: 'Joseph',
        },
        {
          userId: 'agent',
          role: 'assigned_agent',
          phone: '51922222222',
          name: 'Brenda',
        },
      ],
      '51933333333',
    );
    expect(targets.map((row) => row.role)).toEqual(['owner', 'assigned_agent']);
  });
});

describe('staffAlertChannel', () => {
  it('sends from the WAHA inbox session even if a Meta phone id is leftover', () => {
    expect(
      staffAlertChannel({
        provider: 'waha',
        waha_base_url: 'https://waha.example',
      }),
    ).toBe('waha');
    expect(
      staffAlertChannel({
        provider: 'meta',
        waha_base_url: 'https://waha.example',
      }),
    ).toBe('waha');
  });

  it('uses Meta only when WAHA is not configured', () => {
    expect(
      staffAlertChannel({ provider: 'meta', waha_base_url: null }),
    ).toBe('meta');
  });
});
