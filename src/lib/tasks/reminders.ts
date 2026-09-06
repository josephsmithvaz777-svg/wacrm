import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  isUsableStaffPhone,
  sendStaffWhatsApp,
  staffPhoneDigits,
} from "@/lib/automations/staff-notify";
import {
  AUTOMATION_GREETING_TZ,
  formatAlertDateTime,
} from "@/lib/automations/template-vars";
import { zonedDayRange } from "@/lib/datetime/zoned";
import { sendPlainEmail } from "@/lib/email/send";

export interface TaskReminderSummary {
  scanned: number;
  sent: number;
  skipped: number;
  errors: string[];
}

type DueTaskRow = {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id: string | null;
  title: string;
  icon: string | null;
  due_at: string;
  assigned_to: string | null;
  created_by: string | null;
};

function reminderCopy(task: DueTaskRow, contactLabel: string): {
  title: string;
  body: string;
  whatsapp: string;
  emailSubject: string;
  emailText: string;
} {
  const labeled = `${task.icon ? `${task.icon} ` : ""}${task.title}`.trim();
  const when = formatAlertDateTime(new Date(task.due_at));
  const title = "Tarea para hoy";
  const body = `Hoy tienes asignada la tarea «${labeled}» con ${contactLabel}.`;
  const whatsapp = [
    "Recordatorio de tarea",
    `Hoy tienes asignada una tarea.`,
    `Lead: ${contactLabel}`,
    `Tarea: ${labeled}`,
    `Hora: ${when}`,
  ].join("\n");
  return {
    title,
    body,
    whatsapp,
    emailSubject: `Recordatorio: tienes una tarea hoy — ${task.title}`,
    emailText: `${body}\n\nHora: ${when}`,
  };
}

async function contactLabel(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string> {
  const { data } = await db
    .from("contacts")
    .select("name, phone")
    .eq("id", contactId)
    .eq("account_id", accountId)
    .maybeSingle();
  const name = (data?.name as string | null | undefined)?.trim();
  const phone = (data?.phone as string | null | undefined)?.trim();
  return name || phone || "un lead";
}

/**
 * Send WhatsApp + email + in-app notification for open tasks due
 * today (America/Lima). Marks reminder_sent_at first so overlapping
 * cron hits cannot double-send.
 */
export async function sendDueTaskReminders(
  db: SupabaseClient = supabaseAdmin(),
  now: Date = new Date(),
): Promise<TaskReminderSummary> {
  const { start, end } = zonedDayRange(now, AUTOMATION_GREETING_TZ);
  const { data, error } = await db
    .from("lead_tasks")
    .select(
      "id, account_id, contact_id, conversation_id, title, icon, due_at, assigned_to, created_by",
    )
    .is("completed_at", null)
    .is("reminder_sent_at", null)
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
    .limit(100);

  if (error) {
    return { scanned: 0, sent: 0, skipped: 0, errors: [error.message] };
  }

  const tasks = (data as DueTaskRow[] | null) ?? [];
  const summary: TaskReminderSummary = {
    scanned: tasks.length,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  for (const task of tasks) {
    const { data: claim } = await db
      .from("lead_tasks")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", task.id)
      .is("reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claim) {
      summary.skipped += 1;
      continue;
    }

    const advisorId = task.assigned_to || task.created_by;
    if (!advisorId) {
      summary.skipped += 1;
      continue;
    }

    const lead = await contactLabel(db, task.account_id, task.contact_id);
    const copy = reminderCopy(task, lead);

    const { data: profile } = await db
      .from("profiles")
      .select("user_id, phone, email, full_name")
      .eq("user_id", advisorId)
      .maybeSingle();

    const phone = (profile?.phone as string | null | undefined) ?? null;
    const email = (profile?.email as string | null | undefined)?.trim() || "";
    const name = (profile?.full_name as string | null | undefined) ?? null;

    try {
      await db.from("notifications").insert({
        account_id: task.account_id,
        user_id: advisorId,
        type: "task_reminder",
        conversation_id: task.conversation_id,
        contact_id: task.contact_id,
        title: copy.title,
        body: copy.body,
      });
    } catch (err) {
      summary.errors.push(
        `${task.id} notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (isUsableStaffPhone(phone)) {
      try {
        await sendStaffWhatsApp(db, {
          accountId: task.account_id,
          toPhone: staffPhoneDigits(phone) || (phone as string),
          toName: name,
          text: copy.whatsapp,
        });
      } catch (err) {
        summary.errors.push(
          `${task.id} whatsapp: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (email) {
      const mail = await sendPlainEmail({
        to: email,
        subject: copy.emailSubject,
        text: copy.emailText,
      });
      if (!mail.ok && !mail.skipped) {
        summary.errors.push(`${task.id} email: ${mail.error ?? "failed"}`);
      }
    }

    summary.sent += 1;
  }

  return summary;
}
