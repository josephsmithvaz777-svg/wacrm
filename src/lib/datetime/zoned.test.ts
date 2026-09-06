import { describe, expect, it } from "vitest";

import {
  calendarDateInZone,
  combineLocalDateAndTime,
  isSameCalendarDay,
  nextCalendarYmd,
  wallTimeInZone,
  zonedDayRange,
} from "./zoned";

describe("wallTimeInZone / zonedDayRange", () => {
  it("maps Lima midnight to 05:00 UTC", () => {
    const midnight = wallTimeInZone("2026-09-07", "00:00:00", "America/Lima");
    expect(midnight.toISOString()).toBe("2026-09-07T05:00:00.000Z");
  });

  it("covers the Lima calendar day in UTC", () => {
    const { start, end } = zonedDayRange(
      new Date("2026-09-07T18:00:00.000Z"),
      "America/Lima",
    );
    expect(start.toISOString()).toBe("2026-09-07T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-08T05:00:00.000Z");
  });

  it("treats a 15:00 Lima due as the same Lima day", () => {
    const due = wallTimeInZone("2026-09-07", "15:00:00", "America/Lima");
    expect(
      isSameCalendarDay(due, new Date("2026-09-07T18:00:00.000Z"), "America/Lima"),
    ).toBe(true);
    expect(calendarDateInZone(due, "America/Lima")).toBe("2026-09-07");
  });
});

describe("nextCalendarYmd", () => {
  it("rolls the month", () => {
    expect(nextCalendarYmd("2026-09-30")).toBe("2026-10-01");
  });
});

describe("combineLocalDateAndTime", () => {
  it("returns null without a date", () => {
    expect(combineLocalDateAndTime("", "15:00")).toBeNull();
  });

  it("parses a local datetime to an ISO string", () => {
    const iso = combineLocalDateAndTime("2026-09-07", "15:30");
    expect(iso).toBeTruthy();
    expect(new Date(iso as string).getHours()).toBe(15);
    expect(new Date(iso as string).getMinutes()).toBe(30);
  });
});
