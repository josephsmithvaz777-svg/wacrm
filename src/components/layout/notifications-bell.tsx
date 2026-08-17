"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import type { Notification } from "@/types";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS, es, ko } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

const DATE_LOCALE = { en: enUS, es, ko } as const;

export function NotificationsBell() {
  const t = useTranslations("NotificationsPage");
  const tHeader = useTranslations("Header");
  const locale = useLocale();
  const dateLocale =
    DATE_LOCALE[locale as keyof typeof DATE_LOCALE] ?? enUS;
  const router = useRouter();
  const { accountId } = useAuth();
  const unread = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null,
  );
  const [markingAll, setMarkingAll] = useState(false);

  const displayTitle = useCallback(
    (n: Notification) => {
      if (n.type === "conversation_assigned") {
        return t("types.conversationAssigned.title");
      }
      return n.title;
    },
    [t],
  );

  const displayBody = useCallback(
    (n: Notification) => {
      if (
        n.type === "conversation_assigned" &&
        n.body &&
        /assigned you a conversation/i.test(n.body)
      ) {
        return n.body
          .replace(/Someone/i, t("types.conversationAssigned.someone"))
          .replace(
            /assigned you a conversation with/i,
            t("types.conversationAssigned.assignedVerb"),
          )
          .replace(/a contact$/i, t("types.conversationAssigned.aContact"));
      }
      return n.body;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      toast.error(error.message);
      setNotifications([]);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [open, load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (!open) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
                prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open]);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n,
          ) ?? prev,
      );
      const supabase = createClient();
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) {
        toast.error(t("toastMarkReadFailed"));
        void load();
      }
    },
    [load, t],
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) void markRead(n.id);
      setOpen(false);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unreadIds =
    notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev,
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
    setMarkingAll(false);
    if (error) {
      toast.error(t("toastMarkAllFailed"));
      void load();
    }
  }, [unreadIds.length, load, t]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unread > 0
            ? tHeader("notificationsWithCount", { count: unread })
            : tHeader("notifications")
        }
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
          open
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(100vw-1.5rem,22rem)] gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("title")}
            </p>
            <p className="text-[11px] text-muted-foreground">{t("description")}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            disabled={unreadIds.length === 0 || markingAll}
            onClick={() => void markAllRead()}
          >
            {markingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            {t("markAllRead")}
          </Button>
        </div>

        <div className="max-h-[min(70vh,24rem)] overflow-y-auto">
          {notifications === null ? (
            <div className="flex h-28 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <p className="mt-2 text-sm font-medium text-foreground">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("emptyBody")}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                const body = displayBody(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        isUnread && "bg-primary/5",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15" : "bg-muted",
                        )}
                        aria-hidden
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isUnread ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-sm",
                              isUnread
                                ? "font-semibold text-foreground"
                                : "font-medium text-muted-foreground",
                            )}
                          >
                            {displayTitle(n)}
                          </span>
                          {isUnread ? (
                            <span
                              aria-label={t("unread")}
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                            />
                          ) : null}
                        </div>
                        {body ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {body}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                            locale: dateLocale,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
