"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatAlertDateTime } from "@/lib/automations/template-vars";
import {
  dueRelativeParts,
  taskTone,
  taskToneClass,
} from "@/lib/tasks/calendar";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types";

function leadLabel(task: LeadTask, fallback: string): string {
  return task.contact?.name?.trim() || task.contact?.phone || fallback;
}

function chatHref(task: LeadTask): string {
  return task.conversation_id ? `/inbox?c=${task.conversation_id}` : "/inbox";
}

export function TaskEventChip({
  task,
  fallbackLead,
  accountName,
  canEdit,
  onComplete,
  className,
}: {
  task: LeadTask;
  fallbackLead: string;
  accountName?: string | null;
  canEdit: boolean;
  onComplete: (task: LeadTask, result: string) => Promise<void>;
  className?: string;
}) {
  const t = useTranslations("Tasks.page");
  const [result, setResult] = useState(task.result ?? "");
  const [saving, setSaving] = useState(false);
  const tone = taskTone(task);
  const name = leadLabel(task, fallbackLead);

  let when: string | null = null;
  if (task.due_at) {
    const parts = dueRelativeParts(new Date(task.due_at));
    when =
      parts.kind === "yesterday"
        ? t("dueYesterday", { time: parts.time })
        : parts.kind === "today"
          ? t("dueToday", { time: parts.time })
          : parts.kind === "tomorrow"
            ? t("dueTomorrow", { time: parts.time })
            : t("dueOnDate", { date: parts.date, time: parts.time });
    if (tone === "overdue" && parts.overdueDays >= 1) {
      when = `${when} ${t("daysOverdue", { count: parts.overdueDays })}`;
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "block h-full w-full overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight",
          taskToneClass(tone),
          className,
        )}
        title={`${task.icon ? `${task.icon} ` : ""}${task.title} · ${name}`}
      >
        <span className="block truncate font-medium">
          {task.icon ? `${task.icon} ` : ""}
          {task.title}
        </span>
        <span className="block truncate opacity-90">{name}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="w-[min(100vw-2rem,22rem)] gap-2 p-3"
      >
        <Link
          href={chatHref(task)}
          className="text-sm font-medium text-sky-400 hover:underline"
        >
          {name}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {when ? (
            <span
              className={cn(
                tone === "overdue" && "font-medium text-red-400",
                tone === "done" && "font-medium text-emerald-400",
                tone === "open" && "text-muted-foreground",
              )}
            >
              {when}
            </span>
          ) : null}
          {accountName ? (
            <span className="text-muted-foreground">
              {t("forAccount", { name: accountName })}
            </span>
          ) : null}
          <span className="font-medium text-foreground">
            {task.icon ? `${task.icon} ` : ""}
            {task.title}
          </span>
        </p>
        <div className="rounded-md bg-muted/70 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          {task.reminder_whatsapp_at ? (
            <p>
              {t("reminderWhatsAppSent", {
                time: formatAlertDateTime(new Date(task.reminder_whatsapp_at)),
              })}
            </p>
          ) : (
            <p>{t("reminderWhatsAppMissing")}</p>
          )}
          {task.reminder_email_at ? (
            <p>
              {t("reminderEmailSent", {
                time: formatAlertDateTime(new Date(task.reminder_email_at)),
              })}
            </p>
          ) : (
            <p>{t("reminderEmailMissing")}</p>
          )}
          {!task.reminder_sent_at && !task.reminder_whatsapp_at && !task.reminder_email_at ? (
            <p className="mt-1">{t("reminderPendingHint")}</p>
          ) : null}
        </div>
        {tone === "done" && task.result ? (
          <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            {task.result}
          </p>
        ) : null}
        {canEdit && tone !== "done" ? (
          <div className="flex gap-2">
            <input
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder={t("resultPlaceholder")}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void onComplete(task, result).finally(() => setSaving(false));
              }}
            >
              {t("completeTask")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
