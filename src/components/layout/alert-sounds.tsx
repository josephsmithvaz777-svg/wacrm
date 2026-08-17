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
  const { user, accountId } = useAuth();
  const { soundNotifications, soundMessages } = useSoundPrefs();
  const soundNotificationsRef = useRef(soundNotifications);
  const soundMessagesRef = useRef(soundMessages);
  const lastMessageSoundAt = useRef(0);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    soundNotificationsRef.current = soundNotifications;
    soundMessagesRef.current = soundMessages;
  }, [soundNotifications, soundMessages]);

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
          playNotificationSound();
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, accountId]);

  return null;
}
