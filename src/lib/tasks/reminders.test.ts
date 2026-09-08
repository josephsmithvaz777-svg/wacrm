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
  it("waits until the due instant, not just the same calendar day", () => {
    expect(
      shouldPersistTaskReminder(
        "2026-09-08T18:00:00.000Z",
        new Date("2026-09-08T16:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("marks sent when the due instant has arrived", () => {
    expect(
      shouldPersistTaskReminder(
        "2026-09-08T18:00:00.000Z",
        new Date("2026-09-08T18:00:00.000Z"),
      ),
    ).toBe(true);
  });
});

describe("buildTaskReminderCopy", () => {
  it("announces a newly created task", () => {
    const copy = buildTaskReminderCopy(task, "Alfredo", "created");
    expect(copy.title).toBe("Nueva tarea asignada");
    expect(copy.whatsapp).toContain("Nueva tarea asignada");
    expect(copy.emailSubject).toContain("Nueva tarea");
  });

  it("uses the new time when a visit is rescheduled", () => {
    const copy = buildTaskReminderCopy(task, "Alfredo", "reschedule");
    expect(copy.title).toBe("Tarea reprogramada");
    expect(copy.whatsapp).toContain("Nueva hora:");
    expect(copy.emailSubject).toContain("Tarea reprogramada");
  });

  it("uses due-time wording for the exact-time reminder", () => {
    const copy = buildTaskReminderCopy(task, "Alfredo", "due");
    expect(copy.title).toBe("Es la hora de tu tarea");
    expect(copy.whatsapp).toContain("Es la hora de tu tarea");
  });
});
