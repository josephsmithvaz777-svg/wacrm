"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { SoundPrefsProvider } from "@/hooks/use-sound-prefs";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { ProfileThemeHydrator } from "@/components/layout/profile-theme-hydrator";
import { AlertSounds } from "@/components/layout/alert-sounds";
import {
  clearStaleReloadFlag,
  reloadOnceIfStale,
} from "@/lib/navigation/stale-client";
import { cn } from "@/lib/utils";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const fullBleed = pathname.startsWith("/cotizador");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    const settled = window.setTimeout(() => clearStaleReloadFlag(), 5000);
    const onReject = (event: PromiseRejectionEvent) => {
      if (reloadOnceIfStale(event.reason)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      reloadOnceIfStale(event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onReject);
    window.addEventListener("error", onError);
    return () => {
      window.clearTimeout(settled);
      window.removeEventListener("unhandledrejection", onReject);
      window.removeEventListener("error", onError);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <ProfileThemeHydrator />
      <AlertSounds />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main
          className={cn(
            "flex-1",
            fullBleed
              ? "overflow-hidden p-0"
              : "overflow-y-auto p-4 sm:p-6",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SoundPrefsProvider>
        <DashboardShellInner>{children}</DashboardShellInner>
      </SoundPrefsProvider>
    </AuthProvider>
  );
}
