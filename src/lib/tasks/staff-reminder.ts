export type StaffRecurrence = "once" | "weekly" | "yearly";

export const STAFF_RECURRENCES: readonly StaffRecurrence[] = [
  "once",
  "weekly",
  "yearly",
] as const;

export function isStaffRecurrence(value: unknown): value is StaffRecurrence {
  return (
    typeof value === "string" &&
    (STAFF_RECURRENCES as readonly string[]).includes(value)
  );
}

/**
 * Next fire time after `dueAt`. `once` returns null. If the original
 * due date is already in the past, keep stepping until the next
 * occurrence is after `now` so a missed weekly cleaning day still
 * lands on the coming week rather than looping forever in cron.
 */
export function nextStaffReminderDue(
  dueAt: Date | string,
  recurrence: StaffRecurrence,
  now: Date = new Date(),
): Date | null {
  if (recurrence === "once") return null;
  const start = typeof dueAt === "string" ? new Date(dueAt) : new Date(dueAt);
  if (!Number.isFinite(start.getTime())) return null;

  let next = new Date(start);
  let guard = 0;
  const step = () => {
    if (recurrence === "weekly") {
      next.setDate(next.getDate() + 7);
      return;
    }
    const month = next.getMonth();
    const day = next.getDate();
    next.setFullYear(next.getFullYear() + 1);
    // 29 Feb → 28 Feb on non-leap years (JS Date rolls to 1 Mar).
    if (month === 1 && day === 29 && next.getMonth() !== 1) {
      next.setDate(0);
    }
  };

  do {
    step();
  } while (next.getTime() <= now.getTime() && guard++ < 600);
  return next;
}

export function buildStaffReminderCopy(args: {
  title: string;
  icon?: string | null;
  notes?: string | null;
  dueAt?: string | null;
  whenLabel: string;
}): {
  title: string;
  body: string;
  whatsapp: string;
  emailSubject: string;
  emailText: string;
} {
  const labeled = `${args.icon ? `${args.icon} ` : ""}${args.title}`.trim();
  const notes = args.notes?.trim() || "";
  const when = args.whenLabel;
  const body = when
    ? `Recordatorio del equipo: «${labeled}». Hora: ${when}.`
    : `Recordatorio del equipo: «${labeled}».`;
  return {
    title: "Recordatorio del equipo",
    body: notes ? `${body} ${notes}` : body,
    whatsapp: [
      "Recordatorio del equipo",
      labeled,
      ...(when ? [`Hora: ${when}`] : []),
      ...(notes ? [notes] : []),
    ].join("\n"),
    emailSubject: `Recordatorio del equipo — ${args.title}`,
    emailText: notes ? `${body}\n\n${notes}` : body,
  };
}
