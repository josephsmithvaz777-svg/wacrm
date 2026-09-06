/** Calendar YYYY-MM-DD for an instant in a named IANA zone. */
export function calendarDateInZone(
  date: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = read("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}

/** Convert a wall-clock datetime in `timeZone` to a UTC Date. */
export function wallTimeInZone(
  ymd: string,
  hms: string,
  timeZone: string,
): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  const [hour, minute, second] = hms.split(":").map(Number);
  const utcGuess = Date.UTC(
    year,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  return new Date(utcGuess - offsetMsAt(new Date(utcGuess), timeZone));
}

export function nextCalendarYmd(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

/** Inclusive start / exclusive end of the calendar day in `timeZone`. */
export function zonedDayRange(
  now: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const today = calendarDateInZone(now, timeZone);
  return {
    start: wallTimeInZone(today, "00:00:00", timeZone),
    end: wallTimeInZone(nextCalendarYmd(today), "00:00:00", timeZone),
  };
}

export function isSameCalendarDay(
  a: Date,
  b: Date,
  timeZone: string,
): boolean {
  return calendarDateInZone(a, timeZone) === calendarDateInZone(b, timeZone);
}

/**
 * Browser-local date (`YYYY-MM-DD`) + time (`HH:mm`) → ISO UTC.
 * Empty time defaults to 09:00 in the agent's local zone.
 */
export function combineLocalDateAndTime(
  date: string,
  time: string,
): string | null {
  const d = date.trim();
  if (!d) return null;
  const clock = time.trim() || "09:00";
  const local = clock.length === 5 ? `${d}T${clock}:00` : `${d}T${clock}`;
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
