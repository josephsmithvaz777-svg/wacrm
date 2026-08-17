"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useSoundPrefs } from "@/hooks/use-sound-prefs";

/**
 * After the signed-in profile loads, apply ui_theme / ui_mode / sound
 * prefs from the server so they follow the user across devices.
 */
export function ProfileThemeHydrator() {
  const { profile, profileLoading, user } = useAuth();
  const { hydrateFromProfile } = useTheme();
  const { hydrateFromProfile: hydrateSounds } = useSoundPrefs();
  const appliedForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      appliedForUser.current = null;
      return;
    }
    if (profileLoading || !profile) return;
    if (appliedForUser.current === user.id) return;
    appliedForUser.current = user.id;
    hydrateFromProfile({
      ui_theme: profile.ui_theme,
      ui_mode: profile.ui_mode,
    });
    hydrateSounds({
      sound_notifications: profile.sound_notifications,
      sound_messages: profile.sound_messages,
    });
  }, [user, profile, profileLoading, hydrateFromProfile, hydrateSounds]);

  return null;
}
