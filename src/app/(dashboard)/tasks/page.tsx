"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListTodo, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types";

export default function TasksPage() {
  const t = useTranslations("Tasks.page");
  const canEdit = useCan("send-messages");
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant={showDone ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? t("hideDone") : t("showDone")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
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
                  className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-3"
                >
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => void toggleDone(task)}
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      done
                        ? "border-primary bg-primary"
                        : "border-border bg-background",
                      !canEdit && "opacity-60",
                    )}
                    aria-label={done ? t("markOpen") : t("markDone")}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm text-foreground",
                        done && "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {contactName}
                      {task.due_at ? ` · ${t("due", { date: task.due_at })}` : ""}
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
