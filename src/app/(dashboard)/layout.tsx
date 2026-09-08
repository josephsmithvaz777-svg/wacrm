import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { ensureTaskDueReminderLoop } from "@/lib/tasks/reminders";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  ensureTaskDueReminderLoop();
  return <DashboardShell>{children}</DashboardShell>;
}
