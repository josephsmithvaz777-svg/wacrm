"use client";

import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";

export function persistAppLocale(next: AppLocale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
