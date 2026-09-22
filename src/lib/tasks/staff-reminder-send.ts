import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  isUsableStaffPhone,
  sendStaffWhatsApp,
  staffPhoneDigits,
} from "@/lib/automations/staff-notify";
import { formatAlertDateTime } from "@/lib/automations/template-vars";
import { sendPlainEmail } from "@/lib/email/send";
import { TASK_REMINDER_RESET } from "@/lib/tasks/constants";
import {
  buildStaffReminderCopy,
  isStaffRecurrence,
  shouldAdvanceStaffReminder,
  type StaffRecurrence,
} from "@/lib/tasks/staff-reminder";

export interface StaffReminderRecipientRow {
  id: string;
  reminder_id: string;
  user_id: string | null;
  phone: string | null;
  email: string | null;
  label: string | null;
}

export interface StaffReminderRow {
  id: string;
  account_id: string;
  title: string;
  icon: string | null;
  notes: string | null;
  due_at: string;
  recurrence: StaffRecurrence;
  reminder_sent_at: string | null;
  reminder_whatsapp_at: string | null;
  reminder_email_at: string | null;
  completed_at?: string | null;
}

export interface StaffReminderSummary {
  scanned: number;
  sent: number;
  skipped: number;
  errors: string[];
}

function asRecurrence(value: string | null | undefined): StaffRecurrence {
  return isStaffRecurrence(value) ? value : "once";
}

async function resolveRecipient(
  db: SupabaseClient,
  row: StaffReminderRecipientRow,
): Promise<{
  userId: string | null;
  phone: string | null;
  email: string;
  name: string | null;
}> {
  let phone = row.phone;
  let email = (row.email ?? "").trim();
  let name = row.label;
  let userId = row.user_id;

  if (row.user_id) {
    const { data } = await db
      .from("profiles")
      .select("user_id, phone, email, full_name")
      .eq("user_id", row.user_id)
      .maybeSingle();
    if (data) {
      userId = data.user_id as string;
      name = (data.full_name as string | null) || name;
      phone = phone || (data.phone as string | null);
      email = email || ((data.email as string | null)?.trim() ?? "");
    }
  }

  return { userId, phone: phone ?? null, email, name: name ?? null };
}

export async function sendStaffReminder(
  db: SupabaseClient,
  reminder: StaffReminderRow,
  recipients: StaffReminderRecipientRow[],
  now: Date = new Date(),
  options?: { whatsappOnly?: boolean },
): Promise<{ whatsapp: number; email: number; notified: number; errors: string[] }> {
  const errors: string[] = [];
  const when = reminder.due_at
    ? formatAlertDateTime(new Date(reminder.due_at))
    : "";
  const copy = buildStaffReminderCopy({
    title: reminder.title,
    icon: reminder.icon,
    notes: reminder.notes,
    dueAt: reminder.due_at,
    whenLabel: when,
  });

  let whatsapp = 0;
  let emailSent = 0;
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();
  const seenUser = new Set<string>();

  for (const row of recipients) {
    const target = await resolveRecipient(db, row);

    if (!options?.whatsappOnly && target.userId && !seenUser.has(target.userId)) {
      seenUser.add(target.userId);
      try {
        await db.from("notifications").insert({
          account_id: reminder.account_id,
          user_id: target.userId,
          type: "staff_reminder",
          title: copy.title,
          body: copy.body,
        });
      } catch (err) {
        errors.push(
          `notification: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const digits = staffPhoneDigits(target.phone);
    if (isUsableStaffPhone(target.phone) && !seenPhone.has(digits)) {
      seenPhone.add(digits);
      try {
        await sendStaffWhatsApp(db, {
          accountId: reminder.account_id,
          toPhone: digits,
          toName: target.name,
          text: copy.whatsapp,
        });
        whatsapp += 1;
      } catch (err) {
        errors.push(
          `whatsapp ${digits}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (!isUsableStaffPhone(target.phone) && !target.userId) {
      errors.push(
        `${target.name || "recipient"} has no usable WhatsApp number`,
      );
    }

    const mailTo = target.email.toLowerCase();
    if (!options?.whatsappOnly && mailTo && !seenEmail.has(mailTo)) {
      seenEmail.add(mailTo);
      const mail = await sendPlainEmail({
        to: target.email,
        subject: copy.emailSubject,
        text: copy.emailText,
      });
      if (mail.ok) emailSent += 1;
      else if (mail.skipped) errors.push("email skipped: RESEND_API_KEY not set");
      else errors.push(`email ${target.email}: ${mail.error ?? "failed"}`);
    }
  }

  const recurrence = asRecurrence(reminder.recurrence);
  const phoneAttempts = seenPhone.size;
  const nextDue = shouldAdvanceStaffReminder(
    phoneAttempts,
    whatsapp,
    reminder.due_at,
    recurrence,
    now,
  );
  const whatsappDone = phoneAttempts === 0 || whatsapp > 0;
  if (nextDue) {
    await db
      .from("staff_reminders")
      .update({
        due_at: nextDue.toISOString(),
        ...TASK_REMINDER_RESET,
      })
      .eq("id", reminder.id);
  } else if (!options?.whatsappOnly) {
    await db
      .from("staff_reminders")
      .update({
        reminder_sent_at: now.toISOString(),
        reminder_whatsapp_at: whatsappDone ? now.toISOString() : null,
        reminder_email_at: emailSent > 0 ? now.toISOString() : reminder.reminder_email_at,
      })
      .eq("id", reminder.id);
  } else if (whatsappDone) {
    await db
      .from("staff_reminders")
      .update({ reminder_whatsapp_at: now.toISOString() })
      .eq("id", reminder.id);
  }

  return { whatsapp, email: emailSent, notified: seenUser.size, errors };
}

export async function sendDueStaffReminders(
  db: SupabaseClient = supabaseAdmin(),
  now: Date = new Date(),
): Promise<StaffReminderSummary> {
  const { data, error } = await db
    .from("staff_reminders")
    .select(
      "id, account_id, title, icon, notes, due_at, recurrence, reminder_sent_at, reminder_whatsapp_at, reminder_email_at, completed_at",
    )
    .is("completed_at", null)
    .lte("due_at", now.toISOString())
    .or("reminder_sent_at.is.null,reminder_whatsapp_at.is.null")
    .limit(50);

  if (error) {
    return { scanned: 0, sent: 0, skipped: 0, errors: [error.message] };
  }

  const rows = (data as StaffReminderRow[] | null) ?? [];
  const summary: StaffReminderSummary = {
    scanned: rows.length,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  for (const reminder of rows) {
    const retryWhatsApp = Boolean(reminder.reminder_sent_at);
    if (!retryWhatsApp) {
      const { data: claimed } = await db
        .from("staff_reminders")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", reminder.id)
        .is("reminder_sent_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }
    }

    const { data: recipients, error: recErr } = await db
      .from("staff_reminder_recipients")
      .select("id, reminder_id, user_id, phone, email, label")
      .eq("reminder_id", reminder.id);
    if (recErr) {
      summary.errors.push(`${reminder.id} ${recErr.message}`);
      summary.skipped += 1;
      continue;
    }

    const result = await sendStaffReminder(
      db,
      reminder,
      (recipients as StaffReminderRecipientRow[] | null) ?? [],
      now,
      { whatsappOnly: retryWhatsApp },
    );
    if (result.whatsapp > 0 || result.email > 0 || result.notified > 0) summary.sent += 1;
    else summary.skipped += 1;
    summary.errors.push(
      ...result.errors.map((reason) => `${reminder.id} ${reason}`),
    );
  }

  return summary;
}
