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
import { calendarDateInZone, zonedDayRange } from "@/lib/datetime/zoned";
import { sendPlainEmail } from "@/lib/email/send";

export interface TaskReminderSummary {
  scanned: number;
  sent: number;
  skipped: number;
  errors: string[];
}

export type DueTaskRow = {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id: string | null;
  title: string;
  icon: string | null;
  due_at: string;
  assigned_to: string | null;
  created_by: string | null;
  reminder_sent_at?: string | null;
  reminder_whatsapp_at?: string | null;
  reminder_email_at?: string | null;
};

export type TaskReminderKind = "due" | "reschedule";

export function shouldPersistTaskReminder(
  dueAt: string,
  now: Date = new Date(),
  timeZone: string = AUTOMATION_GREETING_TZ,
): boolean {
  return (
    calendarDateInZone(new Date(dueAt), timeZone) <=
    calendarDateInZone(now, timeZone)
  );
}

export function buildTaskReminderCopy(
  task: DueTaskRow,
  contactLabel: string,
  kind: TaskReminderKind = "due",
): {
  title: string;
  body: string;
  whatsapp: string;
  emailSubject: string;
  emailText: string;
} {
  const labeled = `${task.icon ? `${task.icon} ` : ""}${task.title}`.trim();
  const when = formatAlertDateTime(new Date(task.due_at));
  if (kind === "reschedule") {
    const body = `La tarea «${labeled}» con ${contactLabel} se reprogramó a ${when}.`;
    return {
      title: "Tarea reprogramada",
      body,
      whatsapp: [
        "Tarea reprogramada",
        `Lead: ${contactLabel}`,
        `Tarea: ${labeled}`,
        `Nueva hora: ${when}`,
      ].join("\n"),
      emailSubject: `Tarea reprogramada — ${task.title}`,
      emailText: `${body}\n\nNueva hora: ${when}`,
    };
  }
  const title = "Tarea para hoy";
  const body = `Hoy tienes asignada la tarea «${labeled}» con ${contactLabel}.`;
  return {
    title,
    body,
    whatsapp: [
      "Recordatorio de tarea",
      `Hoy tienes asignada una tarea.`,
      `Lead: ${contactLabel}`,
      `Tarea: ${labeled}`,
      `Hora: ${when}`,
    ].join("\n"),
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

export async function sendReminderForTask(
  db: SupabaseClient,
  task: DueTaskRow,
  now: Date = new Date(),
  opts: { markSent?: boolean; kind?: TaskReminderKind } = {},
): Promise<{ whatsapp: boolean; email: boolean; errors: string[] }> {
  const errors: string[] = [];
  const markSent = opts.markSent !== false;
  const kind = opts.kind ?? "due";
  let whatsapp = kind === "reschedule" ? false : Boolean(task.reminder_whatsapp_at);
  let emailSent = kind === "reschedule" ? false : Boolean(task.reminder_email_at);

  if (markSent && !task.reminder_sent_at) {
    await db
      .from("lead_tasks")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", task.id)
      .is("reminder_sent_at", null);
  }

  const advisorId = task.assigned_to || task.created_by;
  if (!advisorId) {
    return { whatsapp, email: emailSent, errors: ["no advisor"] };
  }

  const lead = await contactLabel(db, task.account_id, task.contact_id);
  const copy = buildTaskReminderCopy(task, lead, kind);

  const { data: profile } = await db
    .from("profiles")
    .select("user_id, phone, email, full_name")
    .eq("user_id", advisorId)
    .maybeSingle();

  const phone = (profile?.phone as string | null | undefined) ?? null;
  const email = (profile?.email as string | null | undefined)?.trim() || "";
  const name = (profile?.full_name as string | null | undefined) ?? null;

  if (!task.reminder_sent_at || kind === "reschedule") {
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
      errors.push(
        `notification: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!whatsapp) {
    if (!isUsableStaffPhone(phone)) {
      errors.push("advisor has no usable WhatsApp number");
    } else {
      try {
        await sendStaffWhatsApp(db, {
          accountId: task.account_id,
          toPhone: staffPhoneDigits(phone) || (phone as string),
          toName: name,
          text: copy.whatsapp,
        });
        if (markSent) {
          await db
            .from("lead_tasks")
            .update({ reminder_whatsapp_at: now.toISOString() })
            .eq("id", task.id);
        }
        whatsapp = true;
      } catch (err) {
        errors.push(
          `whatsapp: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (!emailSent) {
    if (!email) {
      errors.push("advisor has no email");
    } else {
      const mail = await sendPlainEmail({
        to: email,
        subject: copy.emailSubject,
        text: copy.emailText,
      });
      if (mail.ok) {
        if (markSent) {
          await db
            .from("lead_tasks")
            .update({ reminder_email_at: now.toISOString() })
            .eq("id", task.id);
        }
        emailSent = true;
      } else if (mail.skipped) {
        errors.push("email skipped: RESEND_API_KEY not set");
      } else {
        errors.push(`email: ${mail.error ?? "failed"}`);
      }
    }
  }

  return { whatsapp, email: emailSent, errors };
}

/**
 * Send WhatsApp + email + in-app notification for open tasks due
 * today or already overdue (America/Lima).
 */
export async function sendDueTaskReminders(
  db: SupabaseClient = supabaseAdmin(),
  now: Date = new Date(),
): Promise<TaskReminderSummary> {
  const { end } = zonedDayRange(now, AUTOMATION_GREETING_TZ);
  const { data, error } = await db
    .from("lead_tasks")
    .select(
      "id, account_id, contact_id, conversation_id, title, icon, due_at, assigned_to, created_by, reminder_sent_at, reminder_whatsapp_at, reminder_email_at",
    )
    .is("completed_at", null)
    .is("reminder_sent_at", null)
    .not("due_at", "is", null)
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
    const result = await sendReminderForTask(db, task, now);
    if (result.whatsapp || result.email) summary.sent += 1;
    else summary.skipped += 1;
    summary.errors.push(
      ...result.errors.map((reason) => `${task.id} ${reason}`),
    );
  }

  return summary;
}
