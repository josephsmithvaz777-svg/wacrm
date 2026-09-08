import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { sendDueTaskReminders, ensureTaskDueReminderLoop } from "@/lib/tasks/reminders";

/**
 * Daily task reminders for advisors (WhatsApp + email + in-app).
 * Auth: same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as the other
 * cron routes. Also invoked from GET /api/automations/cron so existing
 * pingers pick this up without a second schedule.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  ensureTaskDueReminderLoop();
  const reminders = await sendDueTaskReminders();
  return NextResponse.json({ reminders });
}
