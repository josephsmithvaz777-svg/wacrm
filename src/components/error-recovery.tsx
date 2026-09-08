"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { reloadOnceIfStale } from "@/lib/navigation/stale-client";

export function ErrorRecovery({
  error,
  onRetry,
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
}) {
  const t = useTranslations("Errors.page");

  useEffect(() => {
    console.error("[app error]", error);
    reloadOnceIfStale(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
