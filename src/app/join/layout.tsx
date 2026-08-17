// ============================================================
// /join/[token] layout — minimal full-bleed dark shell.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthLocaleSwitcher } from '@/components/auth/auth-locale-switcher';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <AuthLocaleSwitcher />
      </div>
      {children}
    </div>
  );
}
