"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
  isAppLocale,
} from "@/i18n/config";
import { persistAppLocale } from "@/i18n/persist-locale";
import { cn } from "@/lib/utils";

export function LocalePicker({
  className,
  toastOnChange = true,
}: {
  className?: string;
  toastOnChange?: boolean;
}) {
  const t = useTranslations("Settings.appearance");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState<AppLocale | null>(null);
  const active =
    pending ?? (isAppLocale(locale) ? locale : ("en" as AppLocale));

  function pick(next: AppLocale) {
    if (next === active) return;
    setPending(next);
    persistAppLocale(next);
    if (toastOnChange) toast.success(t("languageUpdated"));
    router.refresh();
    setPending(null);
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={cn("grid grid-cols-1 gap-2 sm:grid-cols-3", className)}
    >
      {SUPPORTED_LOCALES.map((code) => {
        const selected = active === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => pick(code)}
            className={cn(
              "flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors",
              selected
                ? "border-primary/60 ring-2 ring-primary/40"
                : "border-border hover:border-border hover:bg-muted/40",
            )}
          >
            <span className="font-medium text-foreground">
              {LOCALE_LABELS[code]}
            </span>
            {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
