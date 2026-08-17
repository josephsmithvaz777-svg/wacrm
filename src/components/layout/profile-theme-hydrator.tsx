"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";

/**
 * After the signed-in profile loads, apply ui_theme / ui_mode from the
 * server so the user's preference follows them across devices.
 */
export function ProfileThemeHydrator() {
  const { profile, profileLoading, user } = useAuth();
  const { hydrateFromProfile } = useTheme();
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
  }, [user, profile, profileLoading, hydrateFromProfile]);

  return null;
}
