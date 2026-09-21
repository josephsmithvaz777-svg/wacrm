import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { ensureTaskDueReminderLoop } from "@/lib/tasks/reminders";
import {
  sendStaffReminder,
  type StaffReminderRecipientRow,
  type StaffReminderRow,
} from "@/lib/tasks/staff-reminder-send";
import { isStaffRecurrence } from "@/lib/tasks/staff-reminder";

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

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("staff_reminders")
      .select(
        "id, account_id, title, icon, notes, due_at, recurrence, reminder_sent_at, reminder_whatsapp_at, reminder_email_at, completed_at",
      )
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }
    if (data.completed_at) {
      return NextResponse.json({ error: "Reminder already done" }, { status: 400 });
    }

    const { data: recipients, error: recErr } = await admin
      .from("staff_reminder_recipients")
      .select("id, reminder_id, user_id, phone, email, label")
      .eq("reminder_id", id);
    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 });
    }

    const reminder: StaffReminderRow = {
      ...(data as Omit<StaffReminderRow, "recurrence">),
      recurrence: isStaffRecurrence(data.recurrence) ? data.recurrence : "once",
    };

    ensureTaskDueReminderLoop();
    const result = await sendStaffReminder(
      admin,
      reminder,
      (recipients as StaffReminderRecipientRow[] | null) ?? [],
    );
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
