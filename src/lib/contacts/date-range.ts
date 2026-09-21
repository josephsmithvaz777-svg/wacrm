import { nextCalendarYmd } from "@/lib/datetime/zoned";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accept a calendar day or reject garbage / impossible dates. */
export function parseYmd(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  const match = YMD_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const local = new Date(year, month - 1, day);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function startOfLocalYmd(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export interface CreatedAtRange {
  fromIso: string | null;
  toIsoExclusive: string | null;
  invalid: boolean;
}

/**
 * Inclusive local calendar days → UTC instants for `created_at`
 * filters. `to` is exclusive (start of the next local day) so
 * "31 Aug" includes the whole of that day.
 */
export function createdAtRange(
  fromYmd: string | null | undefined,
  toYmd: string | null | undefined,
): CreatedAtRange {
  const fromRaw = fromYmd?.trim() ?? "";
  const toRaw = toYmd?.trim() ?? "";
  const from = parseYmd(fromRaw);
  const to = parseYmd(toRaw);
  if ((fromRaw && !from) || (toRaw && !to)) {
    return { fromIso: null, toIsoExclusive: null, invalid: true };
  }
  if (from && to && from > to) {
    return { fromIso: null, toIsoExclusive: null, invalid: true };
  }
  return {
    fromIso: from ? startOfLocalYmd(from).toISOString() : null,
    toIsoExclusive: to
      ? startOfLocalYmd(nextCalendarYmd(to)).toISOString()
      : null,
    invalid: false,
  };
}

export function contactCreatedInRange(
  createdAt: string,
  range: CreatedAtRange,
): boolean {
  if (range.invalid) return false;
  const ts = new Date(createdAt).getTime();
  if (Number.isNaN(ts)) return false;
  if (range.fromIso && ts < Date.parse(range.fromIso)) return false;
  if (range.toIsoExclusive && ts >= Date.parse(range.toIsoExclusive)) {
    return false;
  }
  return true;
}

function ymdFromLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function thisMonthYmd(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymdFromLocal(from), to: ymdFromLocal(now) };
}

export function lastMonthYmd(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: ymdFromLocal(from), to: ymdFromLocal(to) };
}

export function lastNDaysYmd(
  days: number,
  now: Date = new Date(),
): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: ymdFromLocal(from), to: ymdFromLocal(now) };
}

export function formatYmdChip(from: string | null, to: string | null): string {
  if (from && to) return `${from} – ${to}`;
  if (from) return `≥ ${from}`;
  if (to) return `≤ ${to}`;
  return "";
}
