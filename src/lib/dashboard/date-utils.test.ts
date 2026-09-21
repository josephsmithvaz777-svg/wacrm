import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOW_SHORT_MON_FIRST,
  bucketByMonth,
  daysAgoStart,
  formatMinutes,
  lastNDayKeys,
  lastNMonthKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
  startOfLocalMonth,
} from "./date-utils";

describe("startOfLocalDay", () => {
  it("zeroes out the time of a given date", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const out = startOfLocalDay(d);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
    expect(out.getFullYear()).toBe(d.getFullYear());
    expect(out.getMonth()).toBe(d.getMonth());
    expect(out.getDate()).toBe(d.getDate());
  });

  it("does not mutate the input", () => {
    const d = new Date("2026-05-18T13:45:22.500");
    const before = d.getTime();
    startOfLocalDay(d);
    expect(d.getTime()).toBe(before);
  });
});

describe("daysAgoStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T13:45:22"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns midnight N days before today", () => {
    const out = daysAgoStart(3);
    expect(out.getHours()).toBe(0);
    expect(out.getDate()).toBe(15);
    expect(out.getMonth()).toBe(4); // May
    expect(out.getFullYear()).toBe(2026);
  });

  it("daysAgoStart(0) is today at midnight", () => {
    const out = daysAgoStart(0);
    expect(out.getDate()).toBe(18);
    expect(out.getHours()).toBe(0);
  });

  it("crosses month boundaries cleanly", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    const out = daysAgoStart(5);
    expect(out.getMonth()).toBe(3); // April (0-indexed)
    expect(out.getDate()).toBe(27);
  });
});

describe("localDayKey", () => {
  it("emits YYYY-MM-DD in local components", () => {
    const d = new Date(2026, 0, 9, 23, 59); // Jan 9, locally
    expect(localDayKey(d)).toBe("2026-01-09");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2026, 8, 5); // Sep 5
    expect(localDayKey(d)).toBe("2026-09-05");
  });

  it("accepts ISO strings as input", () => {
    expect(localDayKey("2026-12-31T23:00:00")).toBe("2026-12-31");
  });
});

describe("lastNDayKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T08:30:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns n consecutive chronological keys ending today", () => {
    expect(lastNDayKeys(3)).toEqual(["2026-05-16", "2026-05-17", "2026-05-18"]);
  });

  it("returns just today for n=1", () => {
    expect(lastNDayKeys(1)).toEqual(["2026-05-18"]);
  });

  it("rolls back across a month boundary", () => {
    vi.setSystemTime(new Date("2026-05-02T08:00:00"));
    expect(lastNDayKeys(4)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });
});

describe("mondayIndex", () => {
  it("maps Monday → 0 and Sunday → 6", () => {
    expect(mondayIndex(new Date("2026-05-18"))).toBe(0); // Mon
    expect(mondayIndex(new Date("2026-05-19"))).toBe(1); // Tue
    expect(mondayIndex(new Date("2026-05-23"))).toBe(5); // Sat
    expect(mondayIndex(new Date("2026-05-24"))).toBe(6); // Sun
  });

  it("aligns with DOW_SHORT_MON_FIRST labels", () => {
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-18"))]).toBe(
      "Mon",
    );
    expect(DOW_SHORT_MON_FIRST[mondayIndex(new Date("2026-05-24"))]).toBe(
      "Sun",
    );
  });
});

describe("startOfLocalMonth", () => {
  it("lands on the 1st at midnight", () => {
    const out = startOfLocalMonth(new Date("2026-08-19T15:22:00"));
    expect(out.getDate()).toBe(1);
    expect(out.getMonth()).toBe(7);
    expect(out.getHours()).toBe(0);
  });
});

describe("lastNMonthKeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T10:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends on the current month", () => {
    expect(lastNMonthKeys(3)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});

describe("bucketByMonth", () => {
  it("counts timestamps into the provided month keys", () => {
    expect(
      bucketByMonth(
        ["2026-08-02T12:00:00", "2026-08-19T08:00:00", "2026-09-01T00:00:00"],
        ["2026-07", "2026-08", "2026-09"],
      ),
    ).toEqual([
      { month: "2026-07", leads: 0 },
      { month: "2026-08", leads: 2 },
      { month: "2026-09", leads: 1 },
    ]);
  });
});

describe("formatMinutes", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0.4)).toBe("24s");
    expect(formatMinutes(4.2)).toBe("4.2m");
    expect(formatMinutes(90)).toBe("1.5h");
  });
});
