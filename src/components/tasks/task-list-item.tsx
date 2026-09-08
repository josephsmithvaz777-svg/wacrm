"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { TaskAssigneeSelect, assigneeName } from "@/components/tasks/task-assignee-select";
import { TaskDueFields } from "@/components/tasks/task-due-fields";
import { Button } from "@/components/ui/button";
import { AUTOMATION_GREETING_TZ, formatAlertDateTime } from "@/lib/automations/template-vars";
import { combineLocalDateAndTime, splitZonedDateTime } from "@/lib/datetime/zoned";
import { taskTone } from "@/lib/tasks/calendar";
import { cn } from "@/lib/utils";
import type { AccountMember, LeadTask } from "@/types";

export function TaskListItem({
  task,
  canEdit,
  canAssign,
  members,
  onToggleDone,
  onAssign,
  onReschedule,
  onCreateNext,
}: {
  task: LeadTask;
  canEdit: boolean;
  canAssign: boolean;
  members: AccountMember[];
  onToggleDone: (task: LeadTask) => Promise<void>;
  onAssign: (task: LeadTask, agentId: string) => Promise<void>;
  onReschedule: (
    task: LeadTask,
    patch: { title: string; dueAt: string | null },
  ) => Promise<void>;
  onCreateNext: (task: LeadTask, dueAt: string, result?: string) => Promise<void>;
}) {
  const t = useTranslations("Tasks.page");
  const done = Boolean(task.completed_at);
  const tone = taskTone(task);
  const split = splitZonedDateTime(task.due_at, AUTOMATION_GREETING_TZ);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDate, setEditDate] = useState(split.date);
  const [editTime, setEditTime] = useState(split.time);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingNext, setCreatingNext] = useState(false);
  const contactName =
    task.contact?.name?.trim() || task.contact?.phone || t("unknownLead");
  const href = task.conversation_id ? `/inbox?c=${task.conversation_id}` : "/inbox";

  useEffect(() => {
    const next = splitZonedDateTime(task.due_at, AUTOMATION_GREETING_TZ);
    setEditTitle(task.title);
    setEditDate(next.date);
    setEditTime(next.time);
  }, [task.id, task.title, task.due_at]);

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card px-3 py-3",
        tone === "overdue" && "border-red-500/40",
        tone === "done" && "border-emerald-500/40",
        tone === "open" && "border-border",
      )}
    >
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void onToggleDone(task)}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          done
            ? "border-emerald-500 bg-emerald-500"
            : tone === "overdue"
              ? "border-red-500 bg-background"
              : "border-border bg-background",
          !canEdit && "opacity-60",
        )}
        aria-label={done ? t("markOpen") : t("markDone")}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p
          className={cn(
            "text-sm",
            tone === "done" && "text-emerald-400 line-through",
            tone === "overdue" && "text-red-400",
            tone === "open" && "text-foreground",
          )}
        >
          {task.icon ? (
            <span className="mr-1" aria-hidden>
              {task.icon}
            </span>
          ) : null}
          {task.title}
        </p>
        <p
          className={cn(
            "text-xs",
            tone === "overdue" && "text-red-400",
            tone === "done" && "text-emerald-400",
            tone === "open" && "text-muted-foreground",
          )}
        >
          {contactName}
          {task.due_at
            ? ` · ${t("due", { date: formatAlertDateTime(new Date(task.due_at)) })}`
            : ""}
          {` · ${assigneeName(members, task.assigned_to, t("unassigned"))}`}
        </p>
        {canAssign ? (
          <div className="max-w-xs">
            <TaskAssigneeSelect
              value={task.assigned_to ?? ""}
              onChange={(id) => void onAssign(task, id)}
              members={members}
              placeholder={t("assignTo")}
              unassignedLabel={t("unassigned")}
            />
          </div>
        ) : null}
        {canEdit && !done ? (
          <div className="max-w-md space-y-1.5">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              disabled={saving}
              aria-label={t("editTitle")}
              className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50"
            />
            <TaskDueFields
              date={editDate}
              time={editTime}
              onDate={setEditDate}
              onTime={setEditTime}
              dateLabel={t("dueDate")}
              timeLabel={t("dueTime")}
              disabled={saving}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={saving || !editTitle.trim()}
              onClick={() => {
                setSaving(true);
                void onReschedule(task, {
                  title: editTitle.trim(),
                  dueAt: combineLocalDateAndTime(editDate, editTime),
                }).finally(() => setSaving(false));
              }}
            >
              {t("saveAndNotify")}
            </Button>
          </div>
        ) : null}
        {canEdit ? (
          <div className="max-w-md space-y-1.5 border-t border-border pt-2">
            <p className="text-[11px] font-medium text-foreground">
              {t("newAppointmentTitle")}
            </p>
            <TaskDueFields
              date={nextDate}
              time={nextTime}
              onDate={setNextDate}
              onTime={setNextTime}
              dateLabel={t("dueDate")}
              timeLabel={t("dueTime")}
              disabled={creatingNext}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={creatingNext || !nextDate}
              onClick={() => {
                const dueAt = combineLocalDateAndTime(nextDate, nextTime);
                if (!dueAt) return;
                setCreatingNext(true);
                void onCreateNext(task, dueAt).finally(() => {
                  setCreatingNext(false);
                  setNextDate("");
                  setNextTime("");
                });
              }}
            >
              {t("createNewAppointment")}
            </Button>
          </div>
        ) : null}
      </div>
      <Link
        href={href}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {t("openChat")}
      </Link>
    </li>
  );
}
