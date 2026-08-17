"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { enUS, es, ko } from "date-fns/locale";
import {
  Briefcase,
  Loader2,
  MessageSquare,
  Radio,
  RefreshCw,
  UserPlus,
  Users,
  ScrollText,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import type { UserActivityLog } from "@/types";

const DATE_LOCALE = { en: enUS, es, ko } as const;

const ENTITY_ICON: Record<string, typeof ScrollText> = {
  contact: UserPlus,
  deal: Briefcase,
  conversation: MessageSquare,
  message: MessageSquare,
  broadcast: Radio,
  member: Users,
};

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

export function ActivityLogsPanel() {
  const t = useTranslations("Settings.activity");
  const entityLabel = useEntityLabel();
  const locale = useLocale();
  const dateLocale =
    DATE_LOCALE[locale as keyof typeof DATE_LOCALE] ?? enUS;
  const { accountId, canManageMembers } = useAuth();
  const [rows, setRows] = useState<UserActivityLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accountId || !canManageMembers) return;
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
  }, [accountId, canManageMembers]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      if (!row.actor_user_id) continue;
      // Label comes from summary prefix before first verb-ish space chunk —
      // we resolve names via a second pass below when profiles load.
      map.set(row.actor_user_id, row.actor_user_id.slice(0, 8));
    }
    return map;
  }, [rows]);

  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = [...actors.keys()];
    if (ids.length === 0) return;
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", ids);
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
  }, [actors]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (actorFilter === "all") return rows;
    if (actorFilter === "system") {
      return rows.filter((r) => !r.actor_user_id);
    }
    return rows.filter((r) => r.actor_user_id === actorFilter);
  }, [rows, actorFilter]);

  if (!canManageMembers) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="actor-filter">
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
          {[...actors.keys()].map((id) => (
            <option key={id} value={id}>
              {actorNames[id] ?? id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : rows === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-center">
          <ScrollText className="size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">{t("empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p>
        </div>
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
    </section>
  );
}
