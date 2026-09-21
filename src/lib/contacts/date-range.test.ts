import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contactCreatedInRange,
  createdAtRange,
  lastMonthYmd,
  lastNDaysYmd,
  parseYmd,
  thisMonthYmd,
} from "./date-range";

describe("parseYmd", () => {
  it("accepts a real calendar day", () => {
    expect(parseYmd("2026-08-31")).toBe("2026-08-31");
  });

  it("rejects impossible days", () => {
    expect(parseYmd("2026-02-31")).toBeNull();
    expect(parseYmd("08-01")).toBeNull();
  });
});

describe("createdAtRange", () => {
  it("treats the end day as inclusive via an exclusive next-day bound", () => {
    const range = createdAtRange("2026-08-01", "2026-08-31");
    expect(range.invalid).toBe(false);
    expect(range.fromIso).toBe(new Date(2026, 7, 1, 0, 0, 0, 0).toISOString());
    expect(range.toIsoExclusive).toBe(
      new Date(2026, 8, 1, 0, 0, 0, 0).toISOString(),
    );
  });

  it("flags a reversed range", () => {
    expect(createdAtRange("2026-08-31", "2026-08-01").invalid).toBe(true);
  });

  it("keeps a contact created on the last day", () => {
    const range = createdAtRange("2026-08-01", "2026-08-31");
    const lastDay = new Date(2026, 7, 31, 23, 30, 0, 0).toISOString();
    const nextDay = new Date(2026, 8, 1, 0, 0, 0, 0).toISOString();
    expect(contactCreatedInRange(lastDay, range)).toBe(true);
    expect(contactCreatedInRange(nextDay, range)).toBe(false);
  });
});

describe("month presets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 21, 10, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("last month is August when today is 21 Sep", () => {
    expect(lastMonthYmd()).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("this month runs through today", () => {
    expect(thisMonthYmd()).toEqual({ from: "2026-09-01", to: "2026-09-21" });
  });

  it("last 7 days is inclusive of today", () => {
    expect(lastNDaysYmd(7)).toEqual({ from: "2026-09-15", to: "2026-09-21" });
  });
});
