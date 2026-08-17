"use client";

import { useTranslations } from "next-intl";
import { Bell, MessageSquareText, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { useSoundPrefs } from "@/hooks/use-sound-prefs";
import { playMessageSound, playNotificationSound, unlockAudio } from "@/lib/sounds";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function NotificationsSettingsPanel() {
  const t = useTranslations("Settings.notifications");
  const {
    soundNotifications,
    soundMessages,
    setSoundNotifications,
    setSoundMessages,
  } = useSoundPrefs();

  const previewNotification = () => {
    unlockAudio();
    playNotificationSound();
    toast.message(t("previewPlayed"));
  };

  const previewMessage = () => {
    unlockAudio();
    playMessageSound();
    toast.message(t("previewPlayed"));
  };

  return (
    <section className="animate-in fade-in-50 duration-200">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bell className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("assignmentSound")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("assignmentSoundDesc")}
                </p>
              </div>
              <Switch
                checked={soundNotifications}
                onCheckedChange={(v) => setSoundNotifications(!!v)}
                aria-label={t("assignmentSound")}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 px-2 text-xs"
              onClick={previewNotification}
            >
              <Volume2 className="size-3.5" />
              {t("preview")}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquareText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("messageSound")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("messageSoundDesc")}
                </p>
              </div>
              <Switch
                checked={soundMessages}
                onCheckedChange={(v) => setSoundMessages(!!v)}
                aria-label={t("messageSound")}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 px-2 text-xs"
              onClick={previewMessage}
            >
              <Volume2 className="size-3.5" />
              {t("preview")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
