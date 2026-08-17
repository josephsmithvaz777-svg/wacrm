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
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  isMode,
  isThemeId,
  type Mode,
  type ThemeId,
} from "@/lib/themes";

/**
 * ThemeProvider — accent (`data-theme`) + light/dark (`data-mode`).
 *
 * Persistence:
 *   1. localStorage — instant boot / guest / offline cache
 *   2. profiles.ui_theme + profiles.ui_mode — when signed in, so the
 *      preference follows the user across devices
 */

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
  mode: Mode;
  setMode: (next: Mode) => void;
  toggleMode: () => void;
  /** Apply server-side prefs once after profile load (no re-write loop). */
  hydrateFromProfile: (prefs: {
    ui_theme?: string | null;
    ui_mode?: string | null;
  }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const fromAttr = document.documentElement.dataset.theme;
  if (isThemeId(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    // private browsing
  }
  return DEFAULT_THEME;
}

function readInitialMode(): Mode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const fromAttr = document.documentElement.dataset.mode;
  if (isMode(fromAttr)) return fromAttr;
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isMode(stored)) return stored;
  } catch {
    // private browsing
  }
  return DEFAULT_MODE;
}

function applyThemeDom(next: ThemeId) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
}

function applyModeDom(next: Mode) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.mode = next;
  }
  try {
    localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {
    // ignore
  }
}

async function persistProfilePrefs(patch: {
  ui_theme?: ThemeId;
  ui_mode?: Mode;
}) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("user_id", user.id);
    if (error) {
      console.warn("[theme] failed to persist profile prefs:", error.message);
    }
  } catch (err) {
    console.warn("[theme] persist threw:", err);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);
  const [mode, setModeState] = useState<Mode>(readInitialMode);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyThemeDom(next);
    void persistProfilePrefs({ ui_theme: next });
  }, []);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    applyModeDom(next);
    void persistProfilePrefs({ ui_mode: next });
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const hydrateFromProfile = useCallback(
    (prefs: { ui_theme?: string | null; ui_mode?: string | null }) => {
      if (isThemeId(prefs.ui_theme)) {
        setThemeState(prefs.ui_theme);
        applyThemeDom(prefs.ui_theme);
      }
      if (isMode(prefs.ui_mode)) {
        setModeState(prefs.ui_mode);
        applyModeDom(prefs.ui_mode);
      }
    },
    [],
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        if (isThemeId(e.newValue) && e.newValue !== theme) {
          setThemeState(e.newValue);
          document.documentElement.dataset.theme = e.newValue;
        }
        return;
      }
      if (e.key === MODE_STORAGE_KEY) {
        if (isMode(e.newValue) && e.newValue !== mode) {
          setModeState(e.newValue);
          document.documentElement.dataset.mode = e.newValue;
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme, mode]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        mode,
        setMode,
        toggleMode,
        hydrateFromProfile,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: DEFAULT_THEME,
      setTheme: () => {},
      mode: DEFAULT_MODE,
      setMode: () => {},
      toggleMode: () => {},
      hydrateFromProfile: () => {},
    };
  }
  return ctx;
}
