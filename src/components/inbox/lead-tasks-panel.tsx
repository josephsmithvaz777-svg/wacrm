"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TaskIconPicker } from "@/components/inbox/task-icon-picker";
import {
  assigneeName,
  TaskAssigneeSelect,
} from "@/components/tasks/task-assignee-select";
import { TaskDueFields } from "@/components/tasks/task-due-fields";
import { Button } from "@/components/ui/button";
import { useAssignableMembers } from "@/hooks/use-assignable-members";
import { useAuth } from "@/hooks/use-auth";
import { AUTOMATION_GREETING_TZ, formatAlertDateTime } from "@/lib/automations/template-vars";
import {
  calendarDateInZone,
  combineLocalDateAndTime,
  dueAtChanged,
  splitZonedDateTime,
} from "@/lib/datetime/zoned";
import { createClient } from "@/lib/supabase/client";
import { taskTone } from "@/lib/tasks/calendar";
import { notifyTaskAdvisor, TASK_REMINDER_RESET } from "@/lib/tasks/notify";
import { cn } from "@/lib/utils";
import type { AccountMember, LeadTask } from "@/types";

export function LeadTasksPanel({
  contactId,
  accountId,
  conversationId,
  canEdit,
  compact = false,
}: {
  contactId: string;
  accountId: string | null | undefined;
  conversationId?: string | null;
  canEdit: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("Tasks.panel");
  const { canManageMembers, user } = useAuth();
  const members = useAssignableMembers();
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("lead_tasks")
      .select("*")
      .eq("contact_id", contactId)
      .order("completed_at", { ascending: true, nullsFirst: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    setTasks((data as LeadTask[]) ?? []);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const defaultAssignee = useCallback(async (): Promise<string | null> => {
    const supabase = createClient();
    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("assigned_agent_id")
        .eq("id", conversationId)
        .maybeSingle();
      const fromConv =
        (conv?.assigned_agent_id as string | null | undefined) ?? null;
      if (fromConv) return fromConv;
    }
    const { data: contact } = await supabase
      .from("contacts")
      .select("assigned_to")
      .eq("id", contactId)
      .maybeSingle();
    return (contact?.assigned_to as string | null | undefined) ?? null;
  }, [contactId, conversationId]);

  useEffect(() => {
    void defaultAssignee().then((id) => {
      if (id) setAssignedTo(id);
    });
  }, [defaultAssignee]);

  const addTask = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !accountId || !canEdit) return;
    setSaving(true);
    const supabase = createClient();
    const userId = user?.id ?? null;

    let nextAssignee: string | null = assignedTo || null;
    if (!nextAssignee) nextAssignee = await defaultAssignee();
    if (
      nextAssignee &&
      members.length > 0 &&
      !members.some((m) => m.user_id === nextAssignee)
    ) {
      nextAssignee = null;
    }
    if (!nextAssignee && !canManageMembers) nextAssignee = userId;

    const dueIso = combineLocalDateAndTime(dueDate, dueTime);
    const { data: created, error } = await supabase
      .from("lead_tasks")
      .insert({
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId ?? null,
        created_by: userId,
        assigned_to: nextAssignee,
        title: trimmed,
        icon: icon || null,
        due_at: dueIso,
      })
      .select("id, due_at")
      .single();
    setSaving(false);
    if (error) {
      toast.error(t("toastSaveFailed"));
      return;
    }
    if (created?.id && created.due_at) {
      const due = new Date(created.due_at);
      const today = calendarDateInZone(new Date(), AUTOMATION_GREETING_TZ);
      const dueDay = calendarDateInZone(due, AUTOMATION_GREETING_TZ);
      if (dueDay <= today) {
        void notifyTaskAdvisor(created.id);
      }
    }
    setTitle("");
    setIcon("");
    setDueDate("");
    setDueTime("");
    const fallback = await defaultAssignee();
    setAssignedTo(fallback ?? "");
    await load();
  }, [
    accountId,
    assignedTo,
    canEdit,
    canManageMembers,
    contactId,
    conversationId,
    defaultAssignee,
    dueDate,
    dueTime,
    icon,
    load,
    members,
    t,
    title,
    user?.id,
  ]);

  const assignTask = useCallback(
    async (taskId: string, agentId: string) => {
      if (!canEdit || !canManageMembers) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("lead_tasks")
        .update({ assigned_to: agentId || null })
        .eq("id", taskId);
      if (error) {
        toast.error(t("toastAssignFailed"));
        return;
      }
      await load();
    },
    [canEdit, canManageMembers, load, t],
  );

  const toggleDone = useCallback(
    async (task: LeadTask) => {
      if (!canEdit) return;
      const supabase = createClient();
      const { error } = await supabase
        .from("lead_tasks")
        .update({
          completed_at: task.completed_at ? null : new Date().toISOString(),
        })
        .eq("id", task.id);
      if (error) {
        toast.error(t("toastSaveFailed"));
        return;
      }
      await load();
    },
    [canEdit, load, t],
  );

  const removeTask = useCallback(
    async (taskId: string) => {
      if (!canEdit) return;
      const supabase = createClient();
      const { error } = await supabase.from("lead_tasks").delete().eq("id", taskId);
      if (error) {
        toast.error(t("toastDeleteFailed"));
        return;
      }
      await load();
    },
    [canEdit, load, t],
  );

  const rescheduleTask = useCallback(
    async (task: LeadTask, patch: { title: string; dueAt: string | null }) => {
      if (!canEdit) return;
      const supabase = createClient();
      const title = patch.title.trim() || task.title;
      const moved = dueAtChanged(task.due_at, patch.dueAt);
      const { error } = await supabase
        .from("lead_tasks")
        .update({
          title,
          due_at: patch.dueAt,
          ...(moved ? TASK_REMINDER_RESET : {}),
        })
        .eq("id", task.id);
      if (error) {
        toast.error(t("toastSaveFailed"));
        return;
      }
      if (moved && patch.dueAt) {
        const body = await notifyTaskAdvisor(task.id, "reschedule");
        if (body.ok && (body.whatsapp || body.email)) {
          toast.success(t("toastRescheduleOk"));
        } else {
          toast.success(t("toastRescheduleSaved"));
        }
      } else {
        toast.success(t("toastRescheduleSaved"));
      }
      await load();
    },
    [canEdit, load, t],
  );

  const createNextTask = useCallback(
    async (task: LeadTask, dueAt: string) => {
      if (!canEdit || !accountId) return;
      const supabase = createClient();
      if (!task.completed_at) {
        const { error: completeError } = await supabase
          .from("lead_tasks")
          .update({ completed_at: new Date().toISOString() })
          .eq("id", task.id);
        if (completeError) {
          toast.error(t("toastSaveFailed"));
          return;
        }
      }
      const { data, error } = await supabase
        .from("lead_tasks")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          conversation_id: conversationId ?? task.conversation_id ?? null,
          created_by: user?.id ?? null,
          assigned_to: task.assigned_to ?? user?.id ?? null,
          title: task.title,
          icon: task.icon ?? null,
          due_at: dueAt,
        })
        .select("id")
        .single();
      if (error || !data?.id) {
        toast.error(t("toastSaveFailed"));
        await load();
        return;
      }
      const body = await notifyTaskAdvisor(data.id, "reschedule");
      if (body.ok && (body.whatsapp || body.email)) {
        toast.success(t("toastNewAppointmentOk"));
      } else {
        toast.success(t("toastNewAppointmentSaved"));
      }
      await load();
    },
    [accountId, canEdit, contactId, conversationId, load, t, user?.id],
  );

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <ListTodo className="h-3 w-3" />
        {t("title")}
      </div>

      {canEdit ? (
        <div className={cn("mt-2 space-y-1.5", compact ? "" : "px-0")}>
          <div className="flex gap-2">
            <TaskIconPicker
              value={icon}
              onChange={setIcon}
              disabled={saving}
              label={t("pickIcon")}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTask();
                }
              }}
              placeholder={t("placeholder")}
              className="h-8 flex-1 rounded-lg border border-border bg-muted px-2.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-8 bg-primary px-2 hover:bg-primary/90"
              onClick={() => void addTask()}
              disabled={!title.trim() || saving}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-2">
            <TaskDueFields
              date={dueDate}
              time={dueTime}
              onDate={setDueDate}
              onTime={setDueTime}
              dateLabel={t("dueDate")}
              timeLabel={t("dueTime")}
            />
          </div>
          {canManageMembers ? (
            <TaskAssigneeSelect
              value={assignedTo}
              onChange={setAssignedTo}
              members={members}
              disabled={saving}
              placeholder={t("assignTo")}
              unassignedLabel={t("unassigned")}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 space-y-1.5">
        {tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          tasks.map((task) => (
            <PanelTaskRow
              key={task.id}
              task={task}
              canEdit={canEdit}
              canManageMembers={canManageMembers}
              members={members}
              onToggleDone={toggleDone}
              onAssign={assignTask}
              onRemove={removeTask}
              onReschedule={rescheduleTask}
              onCreateNext={createNextTask}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PanelTaskRow({
  task,
  canEdit,
  canManageMembers,
  members,
  onToggleDone,
  onAssign,
  onRemove,
  onReschedule,
  onCreateNext,
}: {
  task: LeadTask;
  canEdit: boolean;
  canManageMembers: boolean;
  members: AccountMember[];
  onToggleDone: (task: LeadTask) => Promise<void>;
  onAssign: (taskId: string, agentId: string) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  onReschedule: (
    task: LeadTask,
    patch: { title: string; dueAt: string | null },
  ) => Promise<void>;
  onCreateNext: (task: LeadTask, dueAt: string) => Promise<void>;
}) {
  const t = useTranslations("Tasks.panel");
  const done = Boolean(task.completed_at);
  const tone = taskTone(task);
  const dueLabel = task.due_at
    ? formatAlertDateTime(new Date(task.due_at))
    : null;
  const split = splitZonedDateTime(task.due_at, AUTOMATION_GREETING_TZ);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDate, setEditDate] = useState(split.date);
  const [editTime, setEditTime] = useState(split.time);
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingNext, setCreatingNext] = useState(false);
  const [addingNext, setAddingNext] = useState(false);

  useEffect(() => {
    const next = splitZonedDateTime(task.due_at, AUTOMATION_GREETING_TZ);
    setEditTitle(task.title);
    setEditDate(next.date);
    setEditTime(next.time);
  }, [task.id, task.title, task.due_at]);

  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2">
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void onToggleDone(task)}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card",
          !canEdit && "opacity-60",
        )}
        aria-label={done ? t("markOpen") : t("markDone")}
      >
        {done ? <Check className="h-3 w-3" /> : null}
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className={cn(
            "text-xs",
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
        {dueLabel ? (
          <p
            className={cn(
              "text-[10px]",
              tone === "overdue" && "text-red-400",
              tone === "done" && "text-emerald-400",
              tone === "open" && "text-muted-foreground",
            )}
          >
            {t("due", { date: dueLabel })}
          </p>
        ) : null}
        {canManageMembers ? (
          <TaskAssigneeSelect
            value={task.assigned_to ?? ""}
            onChange={(id) => void onAssign(task.id, id)}
            members={members}
            placeholder={t("assignTo")}
            unassignedLabel={t("unassigned")}
          />
        ) : task.assigned_to ? (
          <p className="text-[10px] text-muted-foreground">
            {assigneeName(members, task.assigned_to, t("unassigned"))}
          </p>
        ) : null}
        {canEdit && editing && !done ? (
          <div className="space-y-1.5">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              disabled={saving}
              aria-label={t("editTitle")}
              className="h-7 w-full rounded-md border border-border bg-card px-2 text-[11px] text-foreground outline-none focus:border-primary/50"
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
              className="h-7 w-full"
              disabled={saving || !editTitle.trim()}
              onClick={() => {
                setSaving(true);
                void onReschedule(task, {
                  title: editTitle.trim(),
                  dueAt: combineLocalDateAndTime(editDate, editTime),
                }).finally(() => {
                  setSaving(false);
                  setEditing(false);
                });
              }}
            >
              {t("saveAndNotify")}
            </Button>
          </div>
        ) : null}
        {canEdit && addingNext ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-foreground">
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
              className="h-7 w-full"
              disabled={creatingNext || !nextDate}
              onClick={() => {
                const dueAt = combineLocalDateAndTime(nextDate, nextTime);
                if (!dueAt) return;
                setCreatingNext(true);
                void onCreateNext(task, dueAt).finally(() => {
                  setCreatingNext(false);
                  setAddingNext(false);
                  setNextDate("");
                  setNextTime("");
                });
              }}
            >
              {t("createNewAppointment")}
            </Button>
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setAddingNext(true)}
            className="text-[10px] text-sky-400 hover:underline"
          >
            {t("newAppointmentTitle")}
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex shrink-0 flex-col gap-1">
          {!done ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("editTitle")}
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onRemove(task.id)}
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("delete")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
