import { csvExportUrl, gvizCsvUrl } from './sheet-url';

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_HEADERS = {
  Accept: 'text/csv,text/plain,*/*',
  'User-Agent': 'WACRM-SheetSync/1.0',
};

export class SheetFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetFetchError';
  }
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('text/html')) return true;
  const start = body.trimStart().slice(0, 20).toLowerCase();
  return start.startsWith('<!doctype') || start.startsWith('<html');
}

async function fetchCsv(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: FETCH_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new SheetFetchError(
        `Google Sheets respondió ${res.status}. Comparte la hoja como “Cualquiera con el enlace”.`,
      );
    }
    const body = await res.text();
    if (looksLikeHtml(body, res.headers.get('content-type'))) {
      throw new SheetFetchError(
        'La hoja no es pública. En Google Sheets: Compartir → “Cualquiera con el enlace” (lector).',
      );
    }
    if (!body.trim()) {
      throw new SheetFetchError('La hoja está vacía.');
    }
    return body;
  } catch (err) {
    if (err instanceof SheetFetchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SheetFetchError('Google Sheets tardó demasiado en responder.');
    }
    throw new SheetFetchError('No se pudo leer la hoja de Google.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSheetCsv(
  spreadsheetId: string,
  sheetGid: string | null,
): Promise<string> {
  try {
    return await fetchCsv(csvExportUrl(spreadsheetId, sheetGid));
  } catch (first) {
    try {
      return await fetchCsv(gvizCsvUrl(spreadsheetId, sheetGid));
    } catch {
      throw first;
    }
  }
}
