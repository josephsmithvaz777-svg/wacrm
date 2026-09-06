import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import type { LeadTask } from "@/types";

export const CALENDAR_HOUR_START = 8;
export const CALENDAR_HOUR_END = 22;
export const CALENDAR_HOUR_HEIGHT = 44;

const WEEK_OPTS = { weekStartsOn: 1 as const };

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthGridDays(anchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchor), WEEK_OPTS);
  const end = endOfWeek(endOfMonth(anchor), WEEK_OPTS);
  return eachDayOfInterval({ start, end });
}

export function shiftCalendarAnchor(
  anchor: Date,
  view: "day" | "week" | "month",
  direction: -1 | 1,
): Date {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addWeeks(anchor, direction);
  return addMonths(anchor, direction);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function tasksDueOnDay(
  tasks: LeadTask[],
  day: Date,
): LeadTask[] {
  return tasks
    .filter((task) => task.due_at && isSameLocalDay(new Date(task.due_at), day))
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
}

/** Hours from CALENDAR_HOUR_START, clamped to the visible grid. */
export function dueHourOffset(due: Date): number {
  const raw = due.getHours() + due.getMinutes() / 60 - CALENDAR_HOUR_START;
  const max = CALENDAR_HOUR_END - CALENDAR_HOUR_START;
  return Math.min(max, Math.max(0, raw));
}

export function hourLabels(): number[] {
  const hours: number[] = [];
  for (let h = CALENDAR_HOUR_START; h <= CALENDAR_HOUR_END; h++) hours.push(h);
  return hours;
}
