"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { createClient } from "@/lib/supabase/client";

const NOTIF_KEY = "wacrm.sound.notifications";
const MSG_KEY = "wacrm.sound.messages";

interface SoundPrefsContextValue {
  soundNotifications: boolean;
  soundMessages: boolean;
  setSoundNotifications: (next: boolean) => void;
  setSoundMessages: (next: boolean) => void;
  hydrateFromProfile: (prefs: {
    sound_notifications?: boolean | null;
    sound_messages?: boolean | null;
  }) => void;
}

const SoundPrefsContext = createContext<SoundPrefsContextValue | null>(null);

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // private browsing
  }
  return fallback;
}

function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}

async function persistProfilePrefs(patch: {
  sound_notifications?: boolean;
  sound_messages?: boolean;
}) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("profiles").update(patch).eq("user_id", user.id);
  } catch {
    // offline / RLS — localStorage still holds the preference
  }
}

export function SoundPrefsProvider({ children }: { children: ReactNode }) {
  const [soundNotifications, setSoundNotificationsState] = useState(true);
  const [soundMessages, setSoundMessagesState] = useState(true);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoundNotificationsState(readBool(NOTIF_KEY, true));
    setSoundMessagesState(readBool(MSG_KEY, true));
    setBooted(true);
  }, []);

  const setSoundNotifications = useCallback((next: boolean) => {
    setSoundNotificationsState(next);
    writeBool(NOTIF_KEY, next);
    void persistProfilePrefs({ sound_notifications: next });
  }, []);

  const setSoundMessages = useCallback((next: boolean) => {
    setSoundMessagesState(next);
    writeBool(MSG_KEY, next);
    void persistProfilePrefs({ sound_messages: next });
  }, []);

  const hydrateFromProfile = useCallback(
    (prefs: {
      sound_notifications?: boolean | null;
      sound_messages?: boolean | null;
    }) => {
      if (typeof prefs.sound_notifications === "boolean") {
        setSoundNotificationsState(prefs.sound_notifications);
        writeBool(NOTIF_KEY, prefs.sound_notifications);
      }
      if (typeof prefs.sound_messages === "boolean") {
        setSoundMessagesState(prefs.sound_messages);
        writeBool(MSG_KEY, prefs.sound_messages);
      }
    },
    [],
  );

  // Avoid flashing wrong toggles before localStorage is read.
  if (!booted) {
    return (
      <SoundPrefsContext.Provider
        value={{
          soundNotifications: true,
          soundMessages: true,
          setSoundNotifications,
          setSoundMessages,
          hydrateFromProfile,
        }}
      >
        {children}
      </SoundPrefsContext.Provider>
    );
  }

  return (
    <SoundPrefsContext.Provider
      value={{
        soundNotifications,
        soundMessages,
        setSoundNotifications,
        setSoundMessages,
        hydrateFromProfile,
      }}
    >
      {children}
    </SoundPrefsContext.Provider>
  );
}

export function useSoundPrefs(): SoundPrefsContextValue {
  const ctx = useContext(SoundPrefsContext);
  if (!ctx) {
    throw new Error("useSoundPrefs must be used within SoundPrefsProvider");
  }
  return ctx;
}
