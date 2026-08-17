"use client";

import { MessageSquare, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuthBrandInfo {
  name?: string | null;
  logoUrl?: string | null;
  /** Invite flow uses the team icon fallback when there is no logo. */
  invite?: boolean;
}

/**
 * Hero brand mark for auth cards: logo when available, else icon + name.
 */
export function AuthBrandMark({
  name,
  logoUrl,
  invite = false,
  className,
}: AuthBrandInfo & { className?: string }) {
  const displayName = name?.trim() || null;
  const logo = logoUrl?.trim() || null;

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="mb-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 ring-1 ring-primary/20">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={displayName ?? "Logo"}
            className="h-full w-full object-contain p-1.5"
          />
        ) : invite ? (
          <UsersRound className="h-7 w-7 text-primary" />
        ) : (
          <MessageSquare className="h-7 w-7 text-primary" />
        )}
      </div>
      {displayName ? (
        <p className="max-w-[16rem] truncate text-lg font-semibold tracking-tight text-foreground">
          {displayName}
        </p>
      ) : null}
    </div>
  );
}
