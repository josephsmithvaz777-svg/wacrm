/**
 * Parse a Meta Instant Forms → Google Sheets CSV into lead rows.
 * Column names are matched case-insensitively with common aliases.
 */

export interface SheetLeadRow {
  externalId: string;
  createdTime: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  formName: string | null;
  campaignName: string | null;
  adName: string | null;
  extras: Record<string, string>;
  raw: Record<string, string>;
}

export interface ParsedSheetCsv {
  headers: string[];
  rows: SheetLeadRow[];
}

const NAME_KEYS = [
  'full_name',
  'fullname',
  'nombre_y_apellidos',
  'nombres_y_apellidos',
  'nombre_completo',
  'nombre',
  'name',
];
const PHONE_KEYS = [
  'phone_number',
  'numero_de_whatsapp',
  'numero_whatsapp',
  'whatsapp_number',
  'telefono',
  'teléfono',
  'whatsapp',
  'celular',
  'mobile',
  'phone',
  'número',
  'numero',
];
const EMAIL_KEYS = ['email', 'e-mail', 'correo', 'correo_electronico', 'correo_electrónico'];
const ID_KEYS = ['id', 'lead_id', 'leadid'];
const TIME_KEYS = ['created_time', 'created time', 'fecha', 'created_at'];
const FORM_KEYS = ['form_name', 'form', 'formulario'];
const CAMPAIGN_KEYS = ['campaign_name', 'campaign', 'campaña', 'campana'];
const AD_KEYS = ['ad_name', 'ad', 'anuncio'];

const CORE_ALIASES = [
  ...NAME_KEYS,
  ...PHONE_KEYS,
  ...EMAIL_KEYS,
  ...ID_KEYS,
  ...TIME_KEYS,
];

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Exact match, or header contains alias (alias length ≥ 5 so "name" ≠ "campaign_name"). */
function headerMatches(header: string, alias: string): boolean {
  const a = normalizeHeader(alias);
  if (!a || !header) return false;
  if (header === a) return true;
  if (a.length < 5) return false;
  return header.includes(a) || header.split('_').includes(a);
}

function pick(map: Record<string, string>, aliases: string[]): string | null {
  const entries = Object.entries(map).filter(([, v]) => v.trim());
  const sorted = [...aliases].sort((a, b) => b.length - a.length);

  for (const alias of sorted) {
    const normalized = normalizeHeader(alias);
    for (const [key, value] of entries) {
      if (key === normalized) return value.trim();
    }
  }
  for (const alias of sorted) {
    for (const [key, value] of entries) {
      if (headerMatches(key, alias)) return value.trim();
    }
  }
  return null;
}

function isCoreKey(key: string): boolean {
  return CORE_ALIASES.some((alias) => headerMatches(key, alias));
}

/** Split a CSV document into rows of cells. Handles quoted commas/newlines. */
export function parseCsvDocument(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) rows.push(row);
  return rows;
}

function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map(normalizeHeader);
  const hasId = keys.some((k) => ID_KEYS.some((a) => headerMatches(k, a)));
  const hasPhone = keys.some((k) => PHONE_KEYS.some((a) => headerMatches(k, a)));
  const hasName = keys.some((k) => NAME_KEYS.some((a) => headerMatches(k, a)));
  const hasCreated = keys.some((k) => TIME_KEYS.some((a) => headerMatches(k, a)));
  return (hasId && (hasPhone || hasName || hasCreated)) || (hasPhone && hasName);
}

function fingerprint(values: Record<string, string>): string {
  const phone = pick(values, PHONE_KEYS) ?? '';
  const created = pick(values, TIME_KEYS) ?? '';
  const name = pick(values, NAME_KEYS) ?? '';
  const seed = `${phone}|${created}|${name}`;
  return `row:${seed}`;
}

export function parseSheetCsv(text: string): ParsedSheetCsv {
  const table = parseCsvDocument(text);
  if (table.length === 0) return { headers: [], rows: [] };

  let headerIdx = table.findIndex(looksLikeHeader);
  if (headerIdx < 0) headerIdx = 0;

  const headers = table[headerIdx].map(normalizeHeader);
  const rows: SheetLeadRow[] = [];

  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    if (!cells.some((c) => c.length > 0)) continue;

    const raw: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      raw[header] = (cells[idx] ?? '').replace(/^"|"$/g, '').trim();
    });

    const phone = pick(raw, PHONE_KEYS);
    const name = pick(raw, NAME_KEYS);
    const email = pick(raw, EMAIL_KEYS);
    if (!phone && !name && !email) continue;

    const extras: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!value) continue;
      if (isCoreKey(key)) continue;
      extras[key] = value;
    }

    rows.push({
      externalId: pick(raw, ID_KEYS) ?? fingerprint(raw),
      createdTime: pick(raw, TIME_KEYS),
      name,
      phone,
      email,
      formName: pick(raw, FORM_KEYS),
      campaignName: pick(raw, CAMPAIGN_KEYS),
      adName: pick(raw, AD_KEYS),
      extras,
      raw,
    });
  }

  return { headers, rows };
}

export function normalizeLeadPhone(raw: string, countryCode: string): string {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);

  const cc = countryCode.replace(/\D/g, '');
  if (!cc) return digits;

  if (digits.startsWith(cc)) return digits;

  const withoutTrunk = digits.replace(/^0+/, '');
  if (withoutTrunk.length >= 7 && withoutTrunk.length <= 10) {
    return `${cc}${withoutTrunk}`;
  }
  return digits;
}

export function formatLeadNote(row: SheetLeadRow): string {
  const lines: string[] = ['Lead de formulario (Google Sheets)'];
  if (row.formName) lines.push(`Formulario: ${row.formName}`);
  if (row.campaignName) lines.push(`Campaña: ${row.campaignName}`);
  if (row.adName) lines.push(`Anuncio: ${row.adName}`);
  if (row.createdTime) lines.push(`Fecha: ${row.createdTime}`);
  if (row.externalId && !row.externalId.startsWith('row:')) {
    lines.push(`ID Meta: ${row.externalId}`);
  }

  const extraLabels: [string, string][] = Object.entries(row.extras)
    .filter(([key]) => !['is_organic', 'platform', 'lead_status'].includes(key))
    .map(([key, value]) => [key.replace(/_/g, ' '), value]);
  for (const [label, value] of extraLabels) {
    lines.push(`${label}: ${value}`);
  }
  return lines.join('\n');
}
