import { describe, expect, it } from 'vitest';

import {
  buildAudienceCsv,
  buildCrmEvent,
  crmEventIsSendable,
  isMetaLeadId,
  metaCrmRequest,
  parseCapiConfigInput,
  parseFunnelRole,
} from './crm-events';

describe('isMetaLeadId', () => {
  it('accepts the numeric id Meta puts on the sheet', () => {
    expect(isMetaLeadId('12500676705')).toBe(true);
  });

  it('rejects a fingerprint we invented for rows without an id', () => {
    expect(isMetaLeadId('row:+51987654321|2026-10-26|Lucero')).toBe(false);
    expect(isMetaLeadId('')).toBe(false);
  });
});

describe('buildCrmEvent', () => {
  it('marks the event as coming from the CRM and keys it by lead id', () => {
    const event = buildCrmEvent({
      eventName: 'Cita agendada',
      eventTime: new Date('2026-11-26T15:00:00.000Z'),
      leadId: '12500676705',
      eventId: '12500676705:stage-1',
      leadEventSource: 'wacrm',
    });
    expect(event.action_source).toBe('system_generated');
    expect(event.user_data.lead_id).toBe(12500676705);
    expect(event.custom_data).toEqual({
      event_source: 'crm',
      lead_event_source: 'wacrm',
    });
    expect(event.event_name).toBe('Cita agendada');
    expect(event.event_time).toBe(1795705200);
  });
});

describe('metaCrmRequest', () => {
  it('posts to the dataset events edge and keeps the token in the body', () => {
    const request = metaCrmRequest({
      datasetId: '1234567890',
      accessToken: 'secret-token',
      testEventCode: 'TEST123',
      events: [
        {
          eventName: 'Calificado',
          eventTime: new Date('2026-11-26T15:00:00.000Z'),
          leadId: '12500676705',
          eventId: '12500676705:stage',
          leadEventSource: 'wacrm',
        },
      ],
    });
    expect(request.url).toBe(
      'https://graph.facebook.com/v21.0/1234567890/events',
    );
    expect(request.body.access_token).toBe('secret-token');
    expect(request.body.test_event_code).toBe('TEST123');
    expect(request.url.includes('secret-token')).toBe(false);
  });
});

describe('crmEventIsSendable', () => {
  const now = new Date('2026-11-26T15:00:00.000Z');

  it('accepts a stage change from today', () => {
    expect(crmEventIsSendable(new Date('2026-11-26T14:00:00.000Z'), now)).toBe(true);
  });

  it('rejects a stage change older than a week', () => {
    expect(crmEventIsSendable(new Date('2026-11-01T14:00:00.000Z'), now)).toBe(false);
  });
});

describe('parseCapiConfigInput', () => {
  it('requires a dataset id before the integration can be turned on', () => {
    const parsed = parseCapiConfigInput({ enabled: true, dataset_id: '' });
    expect(parsed.ok).toBe(false);
  });

  it('keeps a blank token so the caller can preserve the stored one', () => {
    const parsed = parseCapiConfigInput({
      enabled: true,
      dataset_id: '1234567890',
      access_token: '',
      lead_event_source: 'wacrm',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        enabled: true,
        datasetId: '1234567890',
        accessToken: '',
        leadEventSource: 'wacrm',
        testEventCode: '',
      },
    });
  });
});

describe('parseFunnelRole', () => {
  it('only accepts the three funnel roles', () => {
    expect(parseFunnelRole('positive')).toBe('positive');
    expect(parseFunnelRole('buyer')).toBeNull();
  });
});

describe('buildAudienceCsv', () => {
  it('exports phones and emails the way a Meta customer list expects', () => {
    const { csv, rows } = buildAudienceCsv([
      { name: 'Lucero Valderrama', phone: '+51 987 654 321', email: 'Ana@Example.com' },
      { name: null, phone: null, email: null },
    ]);
    expect(rows).toBe(1);
    expect(csv).toContain('email,phone,fn,ln');
    expect(csv).toContain('ana@example.com,51987654321,Lucero,Valderrama');
  });
});
