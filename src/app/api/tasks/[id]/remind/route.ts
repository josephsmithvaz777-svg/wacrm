import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { sendReminderForTask, type DueTaskRow } from "@/lib/tasks/reminders";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { accountId, role } = await getCurrentAccount();
    if (!hasMinRole(role, "agent")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    const result = await sendReminderForTask(admin, data as DueTaskRow);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
