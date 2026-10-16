"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { daysAgoStart, localDayKey } from "@/lib/dashboard/date-utils";
import {
  MAX_REPORT_DAYS,
  dayKeysBetween,
  loadAgentMessageReport,
  type AgentMessageReport,
} from "@/lib/reports/agent-messages";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Preset = "today" | "7" | "30" | "custom";

function formatDay(key: string, locale: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

export default function AgentMessagesPage() {
  const router = useRouter();
  const t = useTranslations("AgentMessages");
  const locale = useLocale();
  const { canManageMembers, profileLoading } = useAuth();

  const [from, setFrom] = useState(() => localDayKey(daysAgoStart(6)));
  const [to, setTo] = useState(() => localDayKey(new Date()));
  const [preset, setPreset] = useState<Preset>("7");
  const [report, setReport] = useState<AgentMessageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (next: Exclude<Preset, "custom">) => {
    const today = localDayKey(new Date());
    if (next === "today") {
      setFrom(today);
      setTo(today);
    } else if (next === "7") {
      setFrom(localDayKey(daysAgoStart(6)));
      setTo(today);
    } else {
      setFrom(localDayKey(daysAgoStart(29)));
      setTo(today);
    }
    setPreset(next);
  };

  const load = useCallback(async () => {
    const keys = dayKeysBetween(from, to);
    if (!keys) {
      setReport(null);
      setError(t("rangeTooLong", { max: MAX_REPORT_DAYS }));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await loadAgentMessageReport(createClient(), from, to);
      setReport(data);
    } catch (err) {
      console.error("[agent-messages] load failed:", err);
      setReport(null);
      setError(t("error"));
    } finally {
      setLoading(false);
    }
  }, [from, to, t]);

  useEffect(() => {
    if (profileLoading || !canManageMembers) return;
    void load();
  }, [canManageMembers, load, profileLoading]);

  useEffect(() => {
    if (profileLoading) return;
    if (!canManageMembers) router.replace("/dashboard");
  }, [canManageMembers, profileLoading, router]);

  if (profileLoading || !canManageMembers) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const days = report ? [...report.days].reverse() : [];

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t("from")}
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setFrom(event.target.value);
                setPreset("custom");
              }}
              className="w-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t("to")}
            <Input
              type="date"
              value={to}
              min={from}
              max={localDayKey(new Date())}
              onChange={(event) => {
                setTo(event.target.value);
                setPreset("custom");
              }}
              className="w-40"
            />
          </label>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          {(
            [
              ["today", t("today")],
              ["7", t("last7")],
              ["30", t("last30")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyPreset(id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                preset === id
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {report?.truncated ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t("truncated")}
        </p>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("tableTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("note")}</p>
          </div>
          {report ? (
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {t("periodTotal", { count: report.grandTotal })}
            </p>
          ) : null}
        </header>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : !report || report.agents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("emptyAgents")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card px-4">
                  {t("date")}
                </TableHead>
                {report.agents.map((agent) => (
                  <TableHead key={agent.userId} className="text-right">
                    {agent.fullName || t("unknownAgent")}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t("total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => (
                <TableRow key={day}>
                  <TableCell className="sticky left-0 bg-card px-4 font-medium">
                    {formatDay(day, locale)}
                  </TableCell>
                  {report.agents.map((agent) => {
                    const count = agent.byDay[day] ?? 0;
                    return (
                      <TableCell
                        key={agent.userId}
                        className={cn(
                          "text-right tabular-nums",
                          count === 0
                            ? "text-muted-foreground"
                            : "font-medium text-foreground",
                        )}
                      >
                        {count.toLocaleString(locale)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-medium tabular-nums">
                    {(report.dayTotals[day] ?? 0).toLocaleString(locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 bg-muted/50 px-4">
                  {t("total")}
                </TableCell>
                {report.agents.map((agent) => (
                  <TableCell
                    key={agent.userId}
                    className="text-right tabular-nums"
                  >
                    {agent.total.toLocaleString(locale)}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {report.grandTotal.toLocaleString(locale)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </section>
    </div>
  );
}
