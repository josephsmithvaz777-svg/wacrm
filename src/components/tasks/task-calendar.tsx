"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { enUS, es, ko } from "date-fns/locale";
import { format } from "date-fns";

import { TaskEventChip } from "@/components/tasks/task-event-card";
import { Button } from "@/components/ui/button";
import {
  CALENDAR_HOUR_END,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_HOUR_START,
  dueHourOffset,
  hourLabels,
  isSameLocalDay,
  monthGridDays,
  shiftCalendarAnchor,
  tasksDueOnDay,
  weekDays,
} from "@/lib/tasks/calendar";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types";

const DATE_LOCALE = { en: enUS, es, ko } as const;

export function TaskCalendar({
  tasks,
  view,
  anchor,
  onAnchorChange,
  canEdit,
  accountName,
  onComplete,
}: {
  tasks: LeadTask[];
  view: "day" | "week" | "month";
  anchor: Date;
  onAnchorChange: (next: Date) => void;
  canEdit: boolean;
  accountName?: string | null;
  onComplete: (task: LeadTask, result: string) => Promise<void>;
}) {
  const t = useTranslations("Tasks.page");
  const locale = useLocale();
  const dateLocale = DATE_LOCALE[locale as keyof typeof DATE_LOCALE] ?? es;
  const today = new Date();
  const days = view === "month" ? monthGridDays(anchor) : view === "day" ? [anchor] : weekDays(anchor);
  const hours = hourLabels();
  const fallbackLead = t("unknownLead");

  const heading =
    view === "day"
      ? format(anchor, "EEEE d MMM yyyy", { locale: dateLocale })
      : view === "week"
        ? `${format(days[0], "d MMM", { locale: dateLocale })} – ${format(days[days.length - 1], "d MMM yyyy", { locale: dateLocale })}`
        : format(anchor, "MMMM yyyy", { locale: dateLocale });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onAnchorChange(shiftCalendarAnchor(anchor, view, -1))}
          aria-label={t("prev")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAnchorChange(new Date())}
        >
          {t("today")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onAnchorChange(shiftCalendarAnchor(anchor, view, 1))}
          aria-label={t("next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <p className="ml-1 text-sm font-medium capitalize text-foreground">
          {heading}
        </p>
      </div>

      {view === "month" ? (
        <div className="grid flex-1 grid-cols-7 overflow-hidden rounded-xl border border-border bg-card">
          {days.slice(0, 7).map((d) => (
            <div
              key={`h-${d.toISOString()}`}
              className="border-b border-border px-2 py-1.5 text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              {format(d, "EEE", { locale: dateLocale })}
            </div>
          ))}
          {days.map((day) => {
            const items = tasksDueOnDay(tasks, day);
            const extra = items.length - 3;
            const inMonth = day.getMonth() === anchor.getMonth();
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "min-h-[7.5rem] border-b border-r border-border p-1.5",
                  !inMonth && "bg-muted/40",
                  isSameLocalDay(day, today) && "bg-primary/5",
                )}
              >
                <p
                  className={cn(
                    "mb-1 text-xs",
                    isSameLocalDay(day, today)
                      ? "font-semibold text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {format(day, "d")}
                </p>
                <div className="space-y-1">
                  {items.slice(0, 3).map((task) => (
                    <TaskEventChip
                      key={task.id}
                      task={task}
                      fallbackLead={fallbackLead}
                      accountName={accountName}
                      canEdit={canEdit}
                      onComplete={onComplete}
                    />
                  ))}
                  {extra > 0 ? (
                    <p className="px-0.5 text-[10px] text-muted-foreground">
                      {t("moreCount", { count: extra })}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
          <div
            className="grid min-w-[720px]"
            style={{
              gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="sticky top-0 z-10 border-b border-border bg-card" />
            {days.map((day) => (
              <div
                key={`head-${day.toISOString()}`}
                className={cn(
                  "sticky top-0 z-10 border-b border-l border-border bg-card px-2 py-2 text-center text-xs font-medium text-muted-foreground",
                  isSameLocalDay(day, today) && "text-primary",
                )}
              >
                <span className="block uppercase">
                  {format(day, "EEE", { locale: dateLocale })}
                </span>
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full text-sm",
                    isSameLocalDay(day, today) &&
                      "bg-primary text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>
            ))}

            <div className="relative">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="border-t border-border pr-1 text-right text-[10px] text-muted-foreground"
                  style={{ height: CALENDAR_HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            {days.map((day) => {
              const items = tasksDueOnDay(tasks, day);
              return (
                <div
                  key={`col-${day.toISOString()}`}
                  className="relative border-l border-border"
                  style={{
                    height:
                      (CALENDAR_HOUR_END - CALENDAR_HOUR_START + 1) *
                      CALENDAR_HOUR_HEIGHT,
                  }}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="border-t border-border/70"
                      style={{ height: CALENDAR_HOUR_HEIGHT }}
                    />
                  ))}
                  {items.map((task, index) => {
                    const due = new Date(task.due_at as string);
                    return (
                      <div
                        key={task.id}
                        className="absolute right-1"
                        style={{
                          top: dueHourOffset(due) * CALENDAR_HOUR_HEIGHT + 2,
                          left: 4 + Math.min(index, 3) * 6,
                          height: CALENDAR_HOUR_HEIGHT - 6,
                        }}
                      >
                        <TaskEventChip
                          task={task}
                          fallbackLead={fallbackLead}
                          accountName={accountName}
                          canEdit={canEdit}
                          onComplete={onComplete}
                          className="h-full"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
