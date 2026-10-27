import { describe, expect, it } from 'vitest';
import {
  formatLeadNote,
  normalizeLeadPhone,
  parseCsvDocument,
  parseSheetCsv,
} from './sheet-csv';

const META_CSV = `id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,country_residence,interest,property_type,monthly_income,email,phone_number,full_name,lead_status
12500676705,2026-10-26T17:50:24+00:00,ad1,TOUR GOLF,set1,CONJUNTO TOUR,camp1,CAMPANA TOUR,form1,FORM TOUR VIRU,false,fb,Peru,vivienda,,8000,,+51 987 654 321,Lucero Valderrama,QUALIFIED`;

describe('parseCsvDocument', () => {
  it('keeps quoted commas inside a cell', () => {
    expect(parseCsvDocument('a,"b, c",d\n1,"2, 3",4')).toEqual([
      ['a', 'b, c', 'd'],
      ['1', '2, 3', '4'],
    ]);
  });
});

describe('parseSheetCsv', () => {
  it('maps Meta Instant Form columns', () => {
    const parsed = parseSheetCsv(META_CSV);
    expect(parsed.rows).toHaveLength(1);
    const row = parsed.rows[0];
    expect(row.externalId).toBe('12500676705');
    expect(row.name).toBe('Lucero Valderrama');
    expect(row.phone).toBe('+51 987 654 321');
    expect(row.formName).toBe('FORM TOUR VIRU');
    expect(row.campaignName).toBe('CAMPANA TOUR');
    expect(row.adName).toBe('TOUR GOLF');
    expect(row.extras.country_residence).toBe('Peru');
    expect(row.extras.interest).toBe('vivienda');
    expect(row.extras.monthly_income).toBe('8000');
  });

  it('skips a blank title row above the header', () => {
    const csv = `FORM TOUR VIRU\n${META_CSV}`;
    expect(parseSheetCsv(csv).rows[0]?.name).toBe('Lucero Valderrama');
  });

  it('fingerprints a row without an id', () => {
    const csv = `full_name,phone_number\nAna,+51911111111`;
    expect(parseSheetCsv(csv).rows[0]?.externalId).toMatch(/^row:/);
  });

  it('maps Spanish Meta Instant Form headers (nombre_y_apellidos / número_de_whatsapp)', () => {
    const csv = [
      'id,created_time,ad_name,form_name,¿En qué país resides?,Nombre y apellidos,Número de WhatsApp,lead_status',
      'l:1588501672582932,2026-10-27T12:47:19+0000,TOUR GOLF,FORM TOUR VIRU,🇵🇪_Perú,Karla Fabiola Del Aguila,+51927419048,CREATED',
    ].join('\n');
    const row = parseSheetCsv(csv).rows[0];
    expect(row?.externalId).toBe('l:1588501672582932');
    expect(row?.name).toBe('Karla Fabiola Del Aguila');
    expect(row?.phone).toBe('+51927419048');
    expect(row?.formName).toBe('FORM TOUR VIRU');
    expect(row?.adName).toBe('TOUR GOLF');
  });
});

describe('normalizeLeadPhone', () => {
  it('keeps an international number', () => {
    expect(normalizeLeadPhone('+51 987 654 321', '51')).toBe('51987654321');
  });

  it('prepends the default country code for a local mobile', () => {
    expect(normalizeLeadPhone('987654321', '51')).toBe('51987654321');
  });

  it('strips a trunk 0 before prepending', () => {
    expect(normalizeLeadPhone('0987654321', '51')).toBe('51987654321');
  });
});

describe('formatLeadNote', () => {
  it('includes form extras and skips meta noise', () => {
    const note = formatLeadNote({
      externalId: '125',
      createdTime: '2026-10-26T17:50:24+00:00',
      name: 'Lucero',
      phone: '51987654321',
      email: null,
      formName: 'FORM TOUR VIRU',
      campaignName: 'CAMPANA TOUR',
      adName: 'TOUR GOLF',
      extras: {
        country_residence: 'Peru',
        is_organic: 'false',
        platform: 'fb',
      },
      raw: {},
    });
    expect(note).toContain('Formulario: FORM TOUR VIRU');
    expect(note).toContain('country residence: Peru');
    expect(note).not.toContain('is_organic');
  });
});
