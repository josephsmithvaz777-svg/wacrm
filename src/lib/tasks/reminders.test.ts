import { describe, expect, it } from "vitest";

import {
  buildTaskReminderCopy,
  shouldPersistTaskReminder,
  type DueTaskRow,
} from "./reminders";

const task: DueTaskRow = {
  id: "t1",
  account_id: "acc",
  contact_id: "c1",
  conversation_id: null,
  title: "Visita Bosque II",
  icon: "🏠",
  due_at: "2026-09-10T20:00:00.000Z",
  assigned_to: "agent-1",
  created_by: "admin-1",
};

describe("shouldPersistTaskReminder", () => {
  it("marks sent when the new due is today in Lima", () => {
    expect(
      shouldPersistTaskReminder(
        "2026-09-08T18:00:00.000Z",
        new Date("2026-09-08T16:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("leaves the day-of reminder open when the new due is later", () => {
    expect(
      shouldPersistTaskReminder(
        "2026-09-10T20:00:00.000Z",
        new Date("2026-09-08T16:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("buildTaskReminderCopy", () => {
  it("uses the new time when a visit is rescheduled", () => {
    const copy = buildTaskReminderCopy(task, "Alfredo", "reschedule");
    expect(copy.title).toBe("Tarea reprogramada");
    expect(copy.whatsapp).toContain("Nueva hora:");
    expect(copy.emailSubject).toContain("Tarea reprogramada");
  });

  it("keeps the due-day wording for the cron reminder", () => {
    const copy = buildTaskReminderCopy(task, "Alfredo", "due");
    expect(copy.title).toBe("Tarea para hoy");
    expect(copy.whatsapp).toContain("Hoy tienes asignada una tarea");
  });
});
