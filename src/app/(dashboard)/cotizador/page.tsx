"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { getCotizadorUrl } from "@/lib/cotizador";

export default function CotizadorPage() {
  const t = useTranslations("Cotizador");
  const [loaded, setLoaded] = useState(false);
  const src = getCotizadorUrl();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-border bg-background px-3 py-1.5">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
          {t("openExternal")}
        </a>
      </div>
      <div className="relative min-h-0 flex-1">
        {!loaded && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="sr-only">{t("loading")}</span>
          </div>
        )}
        <iframe
          src={src}
          title={t("iframeTitle")}
          className="h-full w-full border-0 bg-background"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="clipboard-write"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
}
