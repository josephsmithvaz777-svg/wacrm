"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ListTodo, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TaskIconPicker } from "@/components/inbox/task-icon-picker";
import { Button } from "@/components/ui/button";
import { formatAlertDateTime } from "@/lib/automations/template-vars";
import { combineLocalDateAndTime } from "@/lib/datetime/zoned";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types";

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
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
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

  const addTask = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || !accountId || !canEdit) return;
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let assignedTo: string | null = null;
    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("assigned_agent_id")
        .eq("id", conversationId)
        .maybeSingle();
      assignedTo =
        (conv?.assigned_agent_id as string | null | undefined) ?? null;
    }
    if (!assignedTo) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("assigned_to")
        .eq("id", contactId)
        .maybeSingle();
      assignedTo =
        (contact?.assigned_to as string | null | undefined) ?? null;
    }
    if (!assignedTo) assignedTo = user?.id ?? null;

    const { error } = await supabase.from("lead_tasks").insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId ?? null,
      created_by: user?.id ?? null,
      assigned_to: assignedTo,
      title: trimmed,
      icon: icon || null,
      due_at: combineLocalDateAndTime(dueDate, dueTime),
    });
    setSaving(false);
    if (error) {
      toast.error(t("toastSaveFailed"));
      return;
    }
    setTitle("");
    setIcon("");
    setDueDate("");
    setDueTime("");
    await load();
  }, [
    accountId,
    canEdit,
    contactId,
    conversationId,
    dueDate,
    dueTime,
    icon,
    load,
    t,
    title,
  ]);

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
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-[11px] text-muted-foreground outline-none focus:border-primary/50"
              aria-label={t("dueDate")}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="h-7 w-[7.25rem] shrink-0 rounded-md border border-border bg-muted px-2 text-[11px] text-muted-foreground outline-none focus:border-primary/50"
              aria-label={t("dueTime")}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-2 space-y-1.5">
        {tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          tasks.map((task) => {
            const done = Boolean(task.completed_at);
            const dueLabel = task.due_at
              ? formatAlertDateTime(new Date(task.due_at))
              : null;
            return (
              <div
                key={task.id}
                className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2"
              >
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void toggleDone(task)}
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
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs text-foreground",
                      done && "text-muted-foreground line-through",
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
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {t("due", { date: dueLabel })}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void removeTask(task.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
