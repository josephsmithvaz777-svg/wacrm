export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Locales with a messages/*.json catalogue. */
export const SUPPORTED_LOCALES = ['en', 'es', 'ko'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  es: 'Español',
  ko: '한국어',
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(
  preferred: string | null | undefined,
  fallbackEnv?: string | null,
  acceptLanguage?: string | null,
): AppLocale {
  if (isAppLocale(preferred)) return preferred;
  if (isAppLocale(fallbackEnv)) return fallbackEnv;
  if (acceptLanguage) {
    const lower = acceptLanguage.toLowerCase();
    // Prefer Spanish for es-* browsers (common for this deployment).
    if (/(^|,)\s*es\b/.test(lower) || lower.includes('es-')) return 'es';
    if (/(^|,)\s*ko\b/.test(lower) || lower.includes('ko-')) return 'ko';
  }
  return 'en';
}
