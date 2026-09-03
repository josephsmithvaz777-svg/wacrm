"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSoundPrefs } from "@/hooks/use-sound-prefs";
import {
  playMessageSound,
  playNotificationSound,
  unlockAudio,
} from "@/lib/sounds";
import type { Message, Notification } from "@/types";

const MESSAGE_THROTTLE_MS = 1600;

/**
 * Dashboard-wide listeners: unlock audio on first gesture, play chimes
 * for new notifications and inbound customer messages when enabled.
 */
export function AlertSounds() {
  const { user, accountId, account } = useAuth();
  const { soundNotifications, soundMessages } = useSoundPrefs();
  const soundNotificationsRef = useRef(soundNotifications);
  const soundMessagesRef = useRef(soundMessages);
  const accountSoundEnabledRef = useRef(
    account?.notification_sound_enabled !== false,
  );
  const accountSoundUrlRef = useRef(account?.notification_sound_url ?? null);
  const lastMessageSoundAt = useRef(0);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    soundNotificationsRef.current = soundNotifications;
    soundMessagesRef.current = soundMessages;
  }, [soundNotifications, soundMessages]);

  useEffect(() => {
    accountSoundEnabledRef.current =
      account?.notification_sound_enabled !== false;
    accountSoundUrlRef.current = account?.notification_sound_url ?? null;
  }, [account?.notification_sound_enabled, account?.notification_sound_url]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!user || !accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`alert-sounds:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          if (!soundNotificationsRef.current) return;
          const row = payload.new as Notification;
          if (row.user_id !== userIdRef.current) return;
          unlockAudio();
          playNotificationSound({
            enabled: accountSoundEnabledRef.current,
            url: accountSoundUrlRef.current,
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (!soundMessagesRef.current) return;
          const row = payload.new as Message;
          if (row.sender_type !== "customer") return;
          const now = Date.now();
          if (now - lastMessageSoundAt.current < MESSAGE_THROTTLE_MS) return;
          lastMessageSoundAt.current = now;
          unlockAudio();
          playMessageSound();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "accounts",
          filter: `id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as {
            notification_sound_enabled?: boolean | null;
            notification_sound_url?: string | null;
          };
          accountSoundEnabledRef.current =
            row.notification_sound_enabled !== false;
          accountSoundUrlRef.current =
            typeof row.notification_sound_url === "string" &&
            row.notification_sound_url.trim()
              ? row.notification_sound_url
              : null;
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, accountId]);

  return null;
}
