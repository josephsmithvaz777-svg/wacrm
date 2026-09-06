"use client";

import { useTranslations } from "next-intl";

import { currenciesInRegion } from "@/lib/currency";
import { cn } from "@/lib/utils";

export function CurrencySelect({
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
  showLabels = true,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** When false, options show only the ISO code (tight deal form). */
  showLabels?: boolean;
}) {
  const t = useTranslations("Currency");
  const latam = currenciesInRegion("latam");
  const other = currenciesInRegion("other");

  const optionText = (code: string, label: string) =>
    showLabels ? `${code} — ${label}` : code;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <optgroup label={t("groupLatam")}>
        {latam.map((c) => (
          <option key={c.code} value={c.code}>
            {optionText(c.code, c.label)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("groupOther")}>
        {other.map((c) => (
          <option key={c.code} value={c.code}>
            {optionText(c.code, c.label)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
