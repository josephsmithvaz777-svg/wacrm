"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { enUS, es, ko } from "date-fns/locale";
import {
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Radio,
  RefreshCw,
  ScrollText,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/automations/trigger-meta";
import type {
  AutomationLog,
  AutomationLogStepResult,
  UserActivityLog,
} from "@/types";

const DATE_LOCALE = { en: enUS, es, ko } as const;

const ENTITY_ICON: Record<string, typeof ScrollText> = {
  contact: UserPlus,
  deal: Briefcase,
  conversation: MessageSquare,
  message: MessageSquare,
  broadcast: Radio,
  member: Users,
};

type LogsView = "automations" | "team";

function useEntityLabel() {
  const t = useTranslations("Settings.activity");
  return (type: string) => {
    switch (type) {
      case "contact":
        return t("entities.contact");
      case "deal":
        return t("entities.deal");
      case "conversation":
        return t("entities.conversation");
      case "message":
        return t("entities.message");
      case "broadcast":
        return t("entities.broadcast");
      case "member":
        return t("entities.member");
      default:
        return type;
    }
  };
}

export function ActivityLogsPanel({ hideHead = false }: { hideHead?: boolean }) {
  const t = useTranslations("Settings.activity");
  const { canManageMembers } = useAuth();
  const [view, setView] = useState<LogsView>("automations");

  if (!canManageMembers) {
    return (
      <section className="max-w-3xl animate-in fade-in-50 duration-200">
        <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      </section>
    );
  }

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      {hideHead ? null : (
        <SettingsPanelHead
          title={t("title")}
          description={t("description")}
        />
      )}

      <div className="mb-5 inline-flex rounded-lg border border-border bg-muted p-1">
        <ViewTab
          active={view === "automations"}
          onClick={() => setView("automations")}
          icon={Zap}
          label={t("tabAutomations")}
        />
        <ViewTab
          active={view === "team"}
          onClick={() => setView("team")}
          icon={Users}
          label={t("tabTeam")}
        />
      </div>

      {view === "automations" ? <AutomationRunsList /> : <TeamActivityList />}
    </section>
  );
}

function ViewTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Zap;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function AutomationRunsList() {
  const t = useTranslations("Settings.activity");
  const tLogs = useTranslations("Automations.logs");
  const { accountId } = useAuth();
  const [rows, setRows] = useState<AutomationLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("automation_logs")
      .select("*, contact:contacts(id, name, phone), automation:automations(id, name)")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(150);
    setLoading(false);
    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as AutomationLog[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t("refresh")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("emptyAutomations")} hint={t("emptyAutomationsHint")} />
      ) : (
        <ul className="space-y-2">
          {rows.map((log) => {
            const isOpen = openLogId === log.id;
            const contactName =
              log.contact?.name || log.contact?.phone || tLogs("unknownContact");
            return (
              <li
                key={log.id}
                className="rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <RunStatus status={log.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {log.automation?.name || t("unnamedAutomation")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {contactName} · {log.trigger_event}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(log.created_at)}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    {log.error_message ? (
                      <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {log.error_message}
                      </p>
                    ) : null}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((result, i) => (
                        <StepRow key={i} result={result} />
                      ))}
                      {(log.steps_executed ?? []).length === 0 ? (
                        <li className="text-xs text-muted-foreground">
                          {tLogs("noSteps")}
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function RunStatus({ status }: { status: AutomationLog["status"] }) {
  const t = useTranslations("Automations.logs");
  const classes =
    status === "success"
      ? "border-primary/30 bg-primary/10 text-primary"
      : status === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        classes,
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function StepRow({ result }: { result: AutomationLogStepResult }) {
  const ok = result.status === "success";
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-primary/20 text-primary" : "bg-red-500/20 text-red-400",
        )}
        aria-hidden
      >
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <span className="text-muted-foreground">{result.step_type}</span>
      {result.detail ? (
        <span className="truncate text-muted-foreground">— {result.detail}</span>
      ) : null}
    </li>
  );
}

function TeamActivityList() {
  const t = useTranslations("Settings.activity");
  const entityLabel = useEntityLabel();
  const locale = useLocale();
  const dateLocale = DATE_LOCALE[locale as keyof typeof DATE_LOCALE] ?? enUS;
  const { accountId } = useAuth();
  const [rows, setRows] = useState<UserActivityLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!accountId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("user_activity_logs")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (fetchErr) {
      setError(fetchErr.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as UserActivityLog[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const actorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows ?? []) {
      if (row.actor_user_id) ids.add(row.actor_user_id);
    }
    return [...ids];
  }, [rows]);

  useEffect(() => {
    if (actorIds.length === 0) return;
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", actorIds);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const p of data) {
        next[p.user_id] =
          (typeof p.full_name === "string" && p.full_name.trim()) ||
          (typeof p.email === "string" && p.email.trim()) ||
          p.user_id.slice(0, 8);
      }
      setActorNames(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [actorIds]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (actorFilter === "all") return rows;
    if (actorFilter === "system") {
      return rows.filter((r) => !r.actor_user_id);
    }
    return rows.filter((r) => r.actor_user_id === actorFilter);
  }, [rows, actorFilter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="actor-filter"
          >
            {t("filterUser")}
          </label>
          <select
            id="actor-filter"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="all">{t("allUsers")}</option>
            <option value="system">{t("system")}</option>
            {actorIds.map((id) => (
              <option key={id} value={id}>
                {actorNames[id] ?? id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t("refresh")}
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t("empty")} hint={t("emptyHint")} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filtered.map((row) => {
            const Icon = ENTITY_ICON[row.entity_type] ?? ScrollText;
            const actor =
              row.actor_user_id == null
                ? t("system")
                : (actorNames[row.actor_user_id] ?? t("unknownUser"));
            return (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{row.summary}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-muted-foreground/90">
                      {actor}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="uppercase tracking-wide">
                      {entityLabel(row.entity_type)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {formatDistanceToNow(new Date(row.created_at), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-center">
      <ScrollText className="size-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
