"use client";

import { useState } from "react";
import { SmilePlus } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const TASK_ICONS = [
  "📞",
  "📱",
  "✅",
  "⏰",
  "🏠",
  "📝",
  "💰",
  "🚗",
  "⭐",
  "🔔",
  "👋",
  "📌",
  "💬",
  "📅",
  "🔥",
  "🎯",
] as const;

export function TaskIconPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-base text-foreground transition-colors hover:border-primary/50 disabled:opacity-40",
        )}
      >
        {value ? (
          <span aria-hidden>{value}</span>
        ) : (
          <SmilePlus className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={cn(
              "flex h-8 items-center justify-center rounded-md text-[10px] text-muted-foreground hover:bg-muted",
              !value && "bg-muted",
            )}
          >
            —
          </button>
          {TASK_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => {
                onChange(icon);
                setOpen(false);
              }}
              className={cn(
                "flex h-8 items-center justify-center rounded-md text-base hover:bg-muted",
                value === icon && "bg-muted ring-1 ring-primary/40",
              )}
            >
              {icon}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
