"use client";

import { memberLabel } from "@/lib/account/members";
import { cn } from "@/lib/utils";
import type { AccountMember } from "@/types";

export function TaskAssigneeSelect({
  value,
  onChange,
  members,
  disabled,
  placeholder,
  unassignedLabel,
  className,
}: {
  value: string;
  onChange: (userId: string) => void;
  members: AccountMember[];
  disabled?: boolean;
  placeholder: string;
  unassignedLabel: string;
  className?: string;
}) {
  const known = members.some((m) => m.user_id === value);

  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 min-w-0 w-full rounded-md border border-border bg-muted px-2 text-[11px] text-foreground outline-none focus:border-primary/50 disabled:opacity-60",
        className,
      )}
    >
      <option value="">{placeholder || unassignedLabel}</option>
      {members.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {memberLabel(m)}
        </option>
      ))}
      {value && !known ? <option value={value}>{value.slice(0, 8)}…</option> : null}
    </select>
  );
}

export function assigneeName(
  members: AccountMember[],
  userId: string | null | undefined,
  fallback: string,
): string {
  if (!userId) return fallback;
  const member = members.find((m) => m.user_id === userId);
  return member ? memberLabel(member) : fallback;
}
