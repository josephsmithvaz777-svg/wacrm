"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";
import { enUS, es, ko } from "date-fns/locale";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AUTOMATION_GREETING_TZ, formatAlertDateTime } from "@/lib/automations/template-vars";
import {
  CALENDAR_HOUR_END,
  CALENDAR_HOUR_HEIGHT,
  CALENDAR_HOUR_START,
  dueHourOffset,
  hourLabels,
  isSameLocalDay,
  monthGridDays,
  shiftCalendarAnchor,
  weekDays,
} from "@/lib/tasks/calendar";
import { calendarDateInZone } from "@/lib/datetime/zoned";
import {
  expandStaffReminderOccurrences,
  weekdayFromYmd,
} from "@/lib/tasks/staff-reminder";
import { cn } from "@/lib/utils";
import type { StaffReminder, StaffReminderRecipient } from "@/types";

const DATE_LOCALE = { en: enUS, es, ko } as const;

interface Occurrence {
  key: string;
  at: Date;
  reminder: StaffReminder;
}

function dayStart(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
}

function dayEnd(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
}

function recipientLabel(row: StaffReminderRecipient): string {
  return (row.label || row.phone || "").trim();
}

export function StaffReminderCalendar({
  items,
  view,
  anchor,
  onAnchorChange,
  canEdit,
  onDelete,
  onComplete,
  onRemind,
}: {
  items: StaffReminder[];
  view: "day" | "week" | "month";
  anchor: Date;
  onAnchorChange: (next: Date) => void;
  canEdit: boolean;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  onRemind: (id: string) => void;
}) {
  const t = useTranslations("Tasks.staff");
  const page = useTranslations("Tasks.page");
  const locale = useLocale();
  const dateLocale = DATE_LOCALE[locale as keyof typeof DATE_LOCALE] ?? es;
  const today = new Date();
  const days =
    view === "month" ? monthGridDays(anchor) : view === "day" ? [anchor] : weekDays(anchor);
  const hours = hourLabels();

  const byDay = useMemo(() => {
    const start = dayStart(days[0]);
    const end = dayEnd(days[days.length - 1]);
    const map = new Map<string, Occurrence[]>();
    for (const reminder of items) {
      if (!reminder.due_at) continue;
      const hits = expandStaffReminderOccurrences(
        reminder.due_at,
        reminder.recurrence,
        start,
        end,
      );
      for (const at of hits) {
        const key = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
        const list = map.get(key) ?? [];
        list.push({
          key: `${reminder.id}-${at.toISOString()}`,
          at,
          reminder,
        });
        map.set(key, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    return map;
  }, [days, items]);

  function eventsOn(day: Date): Occurrence[] {
    return byDay.get(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`) ?? [];
  }

  const heading =
    view === "day"
      ? format(anchor, "EEEE d MMM yyyy", { locale: dateLocale })
      : view === "week"
        ? `${format(days[0], "d MMM", { locale: dateLocale })} – ${format(days[days.length - 1], "d MMM yyyy", { locale: dateLocale })}`
        : format(anchor, "MMMM yyyy", { locale: dateLocale });

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onAnchorChange(shiftCalendarAnchor(anchor, view, -1))}
          aria-label={page("prev")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAnchorChange(new Date())}
        >
          {page("today")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => onAnchorChange(shiftCalendarAnchor(anchor, view, 1))}
          aria-label={page("next")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <p className="ml-1 text-sm font-medium capitalize text-foreground">{heading}</p>
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
            const events = eventsOn(day);
            const extra = events.length - 3;
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
                  {events.slice(0, 3).map((event) => (
                    <StaffEventChip
                      key={event.key}
                      event={event}
                      canEdit={canEdit}
                      t={t}
                      onDelete={onDelete}
                      onComplete={onComplete}
                      onRemind={onRemind}
                    />
                  ))}
                  {extra > 0 ? (
                    <p className="px-0.5 text-[10px] text-muted-foreground">
                      {page("moreCount", { count: extra })}
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
                    isSameLocalDay(day, today) && "bg-primary text-primary-foreground",
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
              const events = eventsOn(day);
              return (
                <div
                  key={`col-${day.toISOString()}`}
                  className="relative border-l border-border"
                  style={{
                    height:
                      (CALENDAR_HOUR_END - CALENDAR_HOUR_START + 1) * CALENDAR_HOUR_HEIGHT,
                  }}
                >
                  {hours.map((hour) => (
                    <div
                      key={hour}
                      className="border-t border-border/70"
                      style={{ height: CALENDAR_HOUR_HEIGHT }}
                    />
                  ))}
                  {events.map((event, index) => (
                    <div
                      key={event.key}
                      className="absolute right-1"
                      style={{
                        top: dueHourOffset(event.at) * CALENDAR_HOUR_HEIGHT + 2,
                        left: 4 + Math.min(index, 3) * 6,
                        height: CALENDAR_HOUR_HEIGHT - 6,
                      }}
                    >
                      <StaffEventChip
                        event={event}
                        canEdit={canEdit}
                        t={t}
                        onDelete={onDelete}
                        onComplete={onComplete}
                        onRemind={onRemind}
                        className="h-full"
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StaffEventChip({
  event,
  canEdit,
  t,
  onDelete,
  onComplete,
  onRemind,
  className,
}: {
  event: Occurrence;
  canEdit: boolean;
  t: ReturnType<typeof useTranslations>;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  onRemind: (id: string) => void;
  className?: string;
}) {
  const { reminder, at } = event;
  const overdue = at.getTime() < Date.now();
  const people = (reminder.recipients ?? []).map(recipientLabel).filter(Boolean);
  const time = format(at, "HH:mm");
  const weekday = weekdayFromYmd(calendarDateInZone(at, AUTOMATION_GREETING_TZ));
  const recurrenceLabel =
    reminder.recurrence === "weekly" && weekday != null
      ? t("weeklyShort", { day: t(`weekday.${weekday}`) })
      : t(`recurrence.${reminder.recurrence}`);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "block h-full w-full overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white",
          overdue ? "bg-red-600 hover:bg-red-500" : "bg-primary hover:bg-primary/90",
          className,
        )}
        title={`${reminder.icon ? `${reminder.icon} ` : ""}${reminder.title}`}
      >
        <span className="block truncate font-medium">
          {time} {reminder.icon ? `${reminder.icon} ` : ""}
          {reminder.title}
        </span>
        {people.length > 0 ? (
          <span className="block truncate opacity-90">{people.join(" · ")}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-[min(100vw-2rem,22rem)] gap-2 p-3">
        <p className="text-sm font-medium text-foreground">
          {reminder.icon ? `${reminder.icon} ` : ""}
          {reminder.title}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatAlertDateTime(at)} · {recurrenceLabel}
        </p>
        <p className="text-xs text-muted-foreground">{t("whatsappAtTime")}</p>
        {people.length > 0 ? (
          <p className="text-xs text-foreground/80">{people.join(" · ")}</p>
        ) : null}
        {reminder.notes ? (
          <p className="text-xs text-foreground/80">{reminder.notes}</p>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-1 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRemind(reminder.id)}
              className="border-border text-muted-foreground"
            >
              <Bell className="size-3.5" />
              {t("sendNow")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onComplete(reminder.id)}
              className="border-border text-muted-foreground"
            >
              {t("done")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(reminder.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              {t("delete")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
