"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ListTodo, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TaskCalendar } from "@/components/tasks/task-calendar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatAlertDateTime } from "@/lib/automations/template-vars";
import { createClient } from "@/lib/supabase/client";
import { taskTone } from "@/lib/tasks/calendar";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types";

type TasksView = "list" | "day" | "week" | "month";

export default function TasksPage() {
  const t = useTranslations("Tasks.page");
  const canEdit = useCan("send-messages");
  const { account } = useAuth();
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<TasksView>("week");
  const [anchor, setAnchor] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("lead_tasks")
      .select("*, contact:contacts(id, name, phone)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (!showDone) query = query.is("completed_at", null);
    const { data } = await query;
    setTasks((data as LeadTask[]) ?? []);
    setLoading(false);
  }, [showDone]);

  useEffect(() => {
    void load();
  }, [load]);

  const completeTask = useCallback(
    async (task: LeadTask, result: string) => {
      if (!canEdit) return;
      const supabase = createClient();
      await supabase
        .from("lead_tasks")
        .update({
          completed_at: new Date().toISOString(),
          result: result.trim() || null,
        })
        .eq("id", task.id);
      await load();
    },
    [canEdit, load],
  );

  const remindTask = useCallback(
    async (task: LeadTask) => {
      const res = await fetch(`/api/tasks/${task.id}/remind`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        whatsapp?: boolean;
        email?: boolean;
        errors?: string[];
      };
      if (!res.ok) {
        toast.error(t("reminderSendFailed"));
        return;
      }
      if (body.whatsapp || body.email) {
        toast.success(t("reminderSendOk"));
      } else {
        toast.error(body.errors?.[0] || t("reminderSendFailed"));
      }
      await load();
    },
    [load, t],
  );

  const toggleDone = useCallback(
    async (task: LeadTask) => {
      if (!canEdit) return;
      const supabase = createClient();
      await supabase
        .from("lead_tasks")
        .update({
          completed_at: task.completed_at ? null : new Date().toISOString(),
        })
        .eq("id", task.id);
      await load();
    },
    [canEdit, load],
  );

  const views: { id: TasksView; label: string }[] = [
    { id: "list", label: t("viewList") },
    { id: "day", label: t("viewDay") },
    { id: "week", label: t("viewWeek") },
    { id: "month", label: t("viewMonth") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  view === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button
            variant={showDone ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? t("hideDone") : t("showDone")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : view !== "list" ? (
          tasks.every((task) => !task.due_at) ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">
                {t("emptyCalendarTitle")}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {t("emptyCalendarBody")}
              </p>
            </div>
          ) : (
            <TaskCalendar
              tasks={tasks}
              view={view}
              anchor={anchor}
              onAnchorChange={setAnchor}
              canEdit={canEdit}
              accountName={account?.name}
              onComplete={completeTask}
              onRemind={remindTask}
            />
          )
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ListTodo className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("emptyTitle")}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => {
              const done = Boolean(task.completed_at);
              const tone = taskTone(task);
              const contactName =
                task.contact?.name?.trim() ||
                task.contact?.phone ||
                t("unknownLead");
              const href = task.conversation_id
                ? `/inbox?c=${task.conversation_id}`
                : "/inbox";
              return (
                <li
                  key={task.id}
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
                    onClick={() => void toggleDone(task)}
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
                  <div className="min-w-0 flex-1">
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
                        "mt-0.5 text-xs",
                        tone === "overdue" && "text-red-400",
                        tone === "done" && "text-emerald-400",
                        tone === "open" && "text-muted-foreground",
                      )}
                    >
                      {contactName}
                      {task.due_at
                        ? ` · ${t("due", { date: formatAlertDateTime(new Date(task.due_at)) })}`
                        : ""}
                    </p>
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
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
