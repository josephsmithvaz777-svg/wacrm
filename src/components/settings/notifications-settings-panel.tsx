"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Loader2, MessageSquareText, Trash2, Upload, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSoundPrefs } from "@/hooks/use-sound-prefs";
import {
  NOTIFICATION_SOUND_MAX_BYTES,
  isNotificationSoundFile,
  playMessageSound,
  playNotificationSound,
  unlockAudio,
} from "@/lib/sounds";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const SOUND_BUCKET = "account-sounds";
const SOUND_ACCEPT =
  "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac,.mp3,.wav,.ogg,.m4a,.aac,.webm";

export function NotificationsSettingsPanel() {
  const t = useTranslations("Settings.notifications");
  const { canManageMembers, account } = useAuth();
  const {
    soundNotifications,
    soundMessages,
    setSoundNotifications,
    setSoundMessages,
  } = useSoundPrefs();

  const previewNotification = () => {
    unlockAudio();
    playNotificationSound({
      enabled: account?.notification_sound_enabled !== false,
      url: account?.notification_sound_url,
    });
    toast.message(t("previewPlayed"));
  };

  const previewMessage = () => {
    unlockAudio();
    playMessageSound();
    toast.message(t("previewPlayed"));
  };

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
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

        {canManageMembers ? <AccountNotificationSoundCard /> : null}
      </div>
    </section>
  );
}

function AccountNotificationSoundCard() {
  const t = useTranslations("Settings.notifications");
  const supabase = createClient();
  const { account, accountId, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(
    account?.notification_sound_enabled !== false,
  );
  const [soundUrl, setSoundUrl] = useState<string | null>(
    account?.notification_sound_url ?? null,
  );
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(account?.notification_sound_enabled !== false);
    setSoundUrl(account?.notification_sound_url ?? null);
  }, [account?.notification_sound_enabled, account?.notification_sound_url]);

  const preview = () => {
    unlockAudio();
    playNotificationSound({ enabled: true, url: soundUrl });
    toast.message(t("previewPlayed"));
  };

  async function persist(patch: {
    notification_sound_enabled?: boolean;
    notification_sound_url?: string | null;
  }) {
    if (!accountId) return;
    const { error } = await supabase
      .from("accounts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", accountId);
    if (error) throw new Error(error.message);
    await refreshProfile();
  }

  async function onToggle(next: boolean) {
    setEnabled(next);
    try {
      await persist({ notification_sound_enabled: next });
      toast.success(next ? t("accountSoundOn") : t("accountSoundOff"));
    } catch (err) {
      setEnabled(!next);
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  async function clearFolder() {
    if (!accountId) return;
    const { data } = await supabase.storage.from(SOUND_BUCKET).list(accountId);
    const paths = (data ?? []).map((row) => `${accountId}/${row.name}`);
    if (paths.length > 0) {
      await supabase.storage.from(SOUND_BUCKET).remove(paths);
    }
  }

  async function onPickFile(file: File | null) {
    if (!file || !accountId) return;
    if (file.size > NOTIFICATION_SOUND_MAX_BYTES) {
      toast.error(t("fileTooLarge"));
      return;
    }
    if (!isNotificationSoundFile(file)) {
      toast.error(t("unsupportedAudio"));
      return;
    }
    setBusy(true);
    setPendingName(file.name);
    try {
      await clearFolder();
      const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
      const path = `${accountId}/notify-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(SOUND_BUCKET)
        .upload(path, file, {
          contentType: file.type || "audio/mpeg",
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = supabase.storage.from(SOUND_BUCKET).getPublicUrl(path);
      await persist({ notification_sound_url: data.publicUrl });
      setSoundUrl(data.publicUrl);
      toast.success(t("uploadSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setBusy(false);
      setPendingName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function restoreDefault() {
    if (!accountId) return;
    setBusy(true);
    try {
      await clearFolder();
      await persist({ notification_sound_url: null });
      setSoundUrl(null);
      toast.success(t("restoredDefault"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t("accountSound")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("accountSoundDesc")}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void onToggle(!!v)}
          disabled={busy}
          aria-label={t("accountSound")}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {soundUrl ? t("customSoundActive") : t("defaultSoundActive")}
        {pendingName ? ` · ${pendingName}` : null}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={SOUND_ACCEPT}
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {t("uploadSound")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={preview}
        >
          <Volume2 className="size-3.5" />
          {t("preview")}
        </Button>
        {soundUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void restoreDefault()}
          >
            <Trash2 className="size-3.5" />
            {t("restoreDefault")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
