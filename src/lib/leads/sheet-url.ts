/**
 * Parse and validate a Google Sheets URL so we only ever fetch
 * docs.google.com / spreadsheets.google.com (SSRF-safe).
 */

const SHEET_HOSTS = new Set([
  'docs.google.com',
  'spreadsheets.google.com',
]);

const SPREADSHEET_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const GID_RE = /^\d{1,18}$/;

export interface ParsedSheetUrl {
  spreadsheetId: string;
  sheetGid: string | null;
  canonicalUrl: string;
}

export function isGoogleSheetsHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return SHEET_HOSTS.has(host);
}

export function parseSheetUrl(raw: string): ParsedSheetUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (!isGoogleSheetsHost(url.hostname)) return null;

  const fromPath = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const spreadsheetId = fromPath?.[1] ?? null;
  if (!spreadsheetId || !SPREADSHEET_ID_RE.test(spreadsheetId)) return null;

  const gidParam = url.searchParams.get('gid');
  const hashGid = url.hash.match(/gid=(\d+)/)?.[1] ?? null;
  const sheetGid = gidParam || hashGid;
  if (sheetGid && !GID_RE.test(sheetGid)) return null;

  const canonicalUrl = sheetGid
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${sheetGid}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return { spreadsheetId, sheetGid: sheetGid ?? null, canonicalUrl };
}

export function csvExportUrl(spreadsheetId: string, sheetGid: string | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
  return sheetGid ? `${base}&gid=${sheetGid}` : base;
}

export function gvizCsvUrl(spreadsheetId: string, sheetGid: string | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
  return sheetGid ? `${base}&gid=${sheetGid}` : base;
}
