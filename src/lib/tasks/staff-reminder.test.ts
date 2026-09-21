import { describe, expect, it } from "vitest";

import {
  buildStaffReminderCopy,
  nextStaffReminderDue,
  nextYmdForWeekday,
  weekdayFromYmd,
} from "./staff-reminder";

describe("nextStaffReminderDue", () => {
  it("returns null for a one-off", () => {
    expect(
      nextStaffReminderDue("2026-09-21T13:00:00.000Z", "once"),
    ).toBeNull();
  });

  it("adds a week for cleaning-day style reminders", () => {
    const next = nextStaffReminderDue(
      "2026-09-21T13:00:00.000Z",
      "weekly",
      new Date("2026-09-21T13:00:00.000Z"),
    );
    expect(next?.toISOString()).toBe("2026-09-28T13:00:00.000Z");
  });

  it("adds a year for birthdays", () => {
    const next = nextStaffReminderDue(
      "2026-08-14T14:00:00.000Z",
      "yearly",
      new Date("2026-08-14T14:00:00.000Z"),
    );
    expect(next?.getUTCFullYear()).toBe(2027);
    expect(next?.getUTCMonth()).toBe(7);
    expect(next?.getUTCDate()).toBe(14);
  });

  it("skips missed weekly occurrences until the next future slot", () => {
    const next = nextStaffReminderDue(
      "2026-09-01T13:00:00.000Z",
      "weekly",
      new Date("2026-09-21T15:00:00.000Z"),
    );
    expect(next && next.getTime() > Date.parse("2026-09-21T15:00:00.000Z")).toBe(
      true,
    );
  });
});

describe("buildStaffReminderCopy", () => {
  it("does not mention a lead", () => {
    const copy = buildStaffReminderCopy({
      title: "Día de limpieza",
      icon: "🧹",
      dueAt: "2026-09-22T13:00:00.000Z",
      whenLabel: "22 sep 2026, 08:00",
    });
    expect(copy.whatsapp).toContain("Día de limpieza");
    expect(copy.whatsapp).not.toMatch(/Lead/i);
    expect(copy.title).toBe("Recordatorio del equipo");
  });
});

describe("weekday helpers", () => {
  it("reads weekday from YYYY-MM-DD", () => {
    // 2026-09-22 is a Tuesday
    expect(weekdayFromYmd("2026-09-22")).toBe(2);
  });

  it("keeps today when it already matches", () => {
    expect(nextYmdForWeekday(2, "2026-09-22")).toBe("2026-09-22");
  });

  it("advances to the next Saturday", () => {
    // 2026-09-21 is Monday → next Saturday is 2026-09-26
    expect(nextYmdForWeekday(6, "2026-09-21")).toBe("2026-09-26");
  });
});
