"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { ActivityLogsPanel } from "@/components/settings/activity-logs-panel";

export default function LogsPage() {
  const router = useRouter();
  const t = useTranslations("Settings.activity");
  const { canManageMembers, profileLoading } = useAuth();

  useEffect(() => {
    if (profileLoading) return;
    if (!canManageMembers) router.replace("/dashboard");
  }, [canManageMembers, profileLoading, router]);

  if (profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!canManageMembers) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <ActivityLogsPanel hideHead />
    </div>
  );
}
