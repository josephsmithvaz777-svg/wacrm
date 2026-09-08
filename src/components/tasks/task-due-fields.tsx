"use client";

import { cn } from "@/lib/utils";

export function TaskDueFields({
  date,
  time,
  onDate,
  onTime,
  dateLabel,
  timeLabel,
  disabled,
  className,
}: {
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  dateLabel: string;
  timeLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      <input
        type="date"
        value={date}
        disabled={disabled}
        onChange={(e) => onDate(e.target.value)}
        aria-label={dateLabel}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-muted px-2 text-[11px] text-foreground outline-none focus:border-primary/50 disabled:opacity-60"
      />
      <input
        type="time"
        value={time}
        disabled={disabled}
        onChange={(e) => onTime(e.target.value)}
        aria-label={timeLabel}
        className="h-7 w-[7.25rem] shrink-0 rounded-md border border-border bg-muted px-2 text-[11px] text-foreground outline-none focus:border-primary/50 disabled:opacity-60"
      />
    </div>
  );
}
