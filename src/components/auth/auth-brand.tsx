"use client";

import { MessageSquare, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuthBrandInfo {
  name?: string | null;
  logoUrl?: string | null;
  /** Optional product line under the company name. */
  tagline?: string | null;
  /** Invite flow uses the team icon fallback when there is no logo. */
  invite?: boolean;
  /** Larger circular mark for the primary login hero. */
  size?: "md" | "lg";
}

/**
 * Hero brand mark for auth cards: logo when available, else icon + name.
 */
export function AuthBrandMark({
  name,
  logoUrl,
  tagline,
  invite = false,
  size = "md",
  className,
}: AuthBrandInfo & { className?: string }) {
  const displayName = name?.trim() || null;
  const logo = logoUrl?.trim() || null;
  const line = tagline?.trim() || null;
  const large = size === "lg";

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div
        className={cn(
          "mb-4 flex items-center justify-center overflow-hidden rounded-full bg-primary/10 ring-2 ring-primary/25",
          large ? "h-28 w-28" : "h-16 w-16",
        )}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={displayName ?? "Logo"}
            className={cn(
              "h-full w-full object-cover",
              large ? "p-0" : "p-0.5",
            )}
          />
        ) : invite ? (
          <UsersRound
            className={cn("text-primary", large ? "h-12 w-12" : "h-7 w-7")}
          />
        ) : (
          <MessageSquare
            className={cn("text-primary", large ? "h-12 w-12" : "h-7 w-7")}
          />
        )}
      </div>
      {displayName ? (
        <p
          className={cn(
            "max-w-[20rem] truncate font-semibold tracking-tight text-foreground",
            large ? "text-xl" : "text-lg",
          )}
        >
          {displayName}
        </p>
      ) : null}
      {line ? (
        <p
          className={cn(
            "mt-1.5 max-w-[22rem] text-balance text-muted-foreground",
            large ? "text-xs leading-relaxed sm:text-sm" : "text-[11px]",
          )}
        >
          {line}
        </p>
      ) : null}
    </div>
  );
}
