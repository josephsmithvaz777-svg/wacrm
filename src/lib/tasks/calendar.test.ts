import { describe, expect, it } from "vitest";

import {
  CALENDAR_HOUR_START,
  dueHourOffset,
  isSameLocalDay,
  monthGridDays,
  taskTone,
  tasksDueOnDay,
  weekDays,
} from "./calendar";
import type { LeadTask } from "@/types";

function task(id: string, dueAt: string): LeadTask {
  return {
    id,
    account_id: "a",
    contact_id: "c",
    title: id,
    due_at: dueAt,
    created_at: dueAt,
  };
}

describe("weekDays", () => {
  it("returns Monday-first week containing the anchor", () => {
    const days = weekDays(new Date(2026, 8, 6)); // Sunday 6 Sep 2026
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(31);
    expect(days[6].getDate()).toBe(6);
  });
});

describe("monthGridDays", () => {
  it("covers the full month in week rows", () => {
    const days = monthGridDays(new Date(2026, 8, 1));
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(1);
  });
});

describe("tasksDueOnDay", () => {
  it("keeps only tasks on that local calendar day", () => {
    const day = new Date(2026, 8, 6, 12, 0, 0);
    const found = tasksDueOnDay(
      [
        task("a", new Date(2026, 8, 6, 14, 22).toISOString()),
        task("b", new Date(2026, 8, 7, 9, 0).toISOString()),
        task("c", ""),
      ],
      day,
    );
    expect(found.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("dueHourOffset", () => {
  it("places 14:22 relative to the 08:00 start", () => {
    const due = new Date(2026, 8, 6, 14, 22);
    expect(dueHourOffset(due)).toBeCloseTo(14 + 22 / 60 - CALENDAR_HOUR_START);
  });
});

describe("isSameLocalDay", () => {
  it("ignores the clock", () => {
    expect(
      isSameLocalDay(new Date(2026, 8, 6, 0, 1), new Date(2026, 8, 6, 23, 59)),
    ).toBe(true);
  });
});

describe("taskTone", () => {
  it("is overdue when the due instant is in the past and open", () => {
    expect(
      taskTone(
        { due_at: "2026-09-01T10:00:00.000Z", completed_at: null },
        new Date("2026-09-06T18:00:00.000Z"),
      ),
    ).toBe("overdue");
  });

  it("is done even if the due instant is in the past", () => {
    expect(
      taskTone(
        {
          due_at: "2026-09-01T10:00:00.000Z",
          completed_at: "2026-09-01T12:00:00.000Z",
        },
        new Date("2026-09-06T18:00:00.000Z"),
      ),
    ).toBe("done");
  });
});
