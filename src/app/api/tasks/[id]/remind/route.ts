import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import {
  sendReminderForTask,
  shouldPersistTaskReminder,
  type DueTaskRow,
  type TaskReminderKind,
} from "@/lib/tasks/reminders";
import { TASK_REMINDER_RESET } from "@/lib/tasks/constants";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { accountId, role } = await getCurrentAccount();
    if (!hasMinRole(role, "agent")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let kind: TaskReminderKind = "due";
    const body = (await request.json().catch(() => ({}))) as {
      reason?: string;
    };
    if (body.reason === "reschedule") kind = "reschedule";

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("lead_tasks")
      .select(
        "id, account_id, contact_id, conversation_id, title, icon, due_at, assigned_to, created_by, reminder_sent_at, reminder_whatsapp_at, reminder_email_at, completed_at",
      )
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (data.completed_at) {
      return NextResponse.json({ error: "Task already done" }, { status: 400 });
    }
    if (!data.due_at) {
      return NextResponse.json({ error: "Task has no due date" }, { status: 400 });
    }

    const task = data as DueTaskRow;
    if (kind === "reschedule") {
      await admin
        .from("lead_tasks")
        .update({ ...TASK_REMINDER_RESET })
        .eq("id", id);
      task.reminder_sent_at = null;
      task.reminder_whatsapp_at = null;
      task.reminder_email_at = null;
    }

    const markSent =
      kind !== "reschedule" || shouldPersistTaskReminder(task.due_at);
    const result = await sendReminderForTask(admin, task, new Date(), {
      markSent,
      kind,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
