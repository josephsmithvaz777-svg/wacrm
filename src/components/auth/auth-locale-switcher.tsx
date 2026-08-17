"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Languages } from "lucide-react";

import {
  LOCALE_COOKIE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
  isAppLocale,
} from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Compact language picker for login / signup / join (pre-auth).
 * Sets NEXT_LOCALE cookie and refreshes so next-intl reloads messages.
 */
export function AuthLocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState<AppLocale | null>(null);
  const active =
    pending ?? (isAppLocale(locale) ? locale : ("en" as AppLocale));

  function pick(next: AppLocale) {
    if (next === active) return;
    setPending(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
    setPending(null);
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {SUPPORTED_LOCALES.map((code) => {
        const selected = active === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => pick(code)}
            className={cn(
              "rounded-md px-2 py-1 transition-colors",
              selected
                ? "bg-primary/15 font-medium text-primary"
                : "hover:bg-muted hover:text-foreground",
            )}
            aria-pressed={selected}
          >
            {LOCALE_LABELS[code]}
          </button>
        );
      })}
    </div>
  );
}
