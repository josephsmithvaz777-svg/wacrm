/**
 * CSV builder for the admin contact export. Headers stay aligned
 * with the import parser (`phone` required, optional `tags`) plus
 * `created_at` so a campaign dump can become a WhatsApp group list.
 */

export const EXPORT_CSV_HEADERS = [
  "phone",
  "name",
  "email",
  "company",
  "tags",
  "created_at",
] as const;

export interface ExportContactRow {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  tags: string[];
  createdAt: string;
}

/** YYYY-MM-DD in the viewer's local calendar. */
export function formatExportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Semicolon-separated tags so a re-import through `parseTagCell`
 * still splits correctly (comma inside a tag name would otherwise
 * look like two tags).
 */
export function formatExportTags(tags: string[]): string {
  return tags
    .map((name) => name.trim())
    .filter(Boolean)
    .join("; ");
}

export function contactsToCsv(rows: ExportContactRow[]): string {
  const lines = [EXPORT_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.phone ?? ""),
        csvCell((row.name ?? "").trim()),
        csvCell((row.email ?? "").trim()),
        csvCell((row.company ?? "").trim()),
        csvCell(formatExportTags(row.tags)),
        csvCell(formatExportDate(row.createdAt)),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Excel-friendly UTF-8 CSV (BOM + CRLF rows). */
export function contactsToCsvBuffer(rows: ExportContactRow[]): Uint8Array {
  const csv = `\uFEFF${contactsToCsv(rows)}`;
  return new TextEncoder().encode(csv);
}

export function exportFilename(now: Date = new Date()): string {
  return `contactos-${formatExportDate(now.toISOString())}.csv`;
}
