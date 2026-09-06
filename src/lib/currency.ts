/**
 * Currency — single source of truth for deal-value formatting and
 * the currency picker options.
 *
 * Before this module, ~6 components each defined their own
 * `Intl.NumberFormat(..., { currency: "USD" })` helper with USD
 * baked in. The default currency is now configurable per account
 * (accounts.default_currency, migration 021), so every formatter
 * takes a currency and falls back to DEFAULT_CURRENCY only when
 * nothing is known.
 */

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = "USD";

export type CurrencyRegion = "latam" | "other";

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, e.g. "US Dollar". */
  label: string;
  /** Symbol for compact display, e.g. "$". */
  symbol: string;
  region: CurrencyRegion;
}

/**
 * The currencies offered in pickers. Codes must be valid ISO-4217 so
 * `Intl.NumberFormat` renders the right symbol/grouping. Extend this
 * list to offer more — nothing else needs to change.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: "ARS", label: "Peso argentino", symbol: "$", region: "latam" },
  { code: "BOB", label: "Boliviano", symbol: "Bs", region: "latam" },
  { code: "BRL", label: "Real brasileño", symbol: "R$", region: "latam" },
  { code: "CLP", label: "Peso chileno", symbol: "$", region: "latam" },
  { code: "COP", label: "Peso colombiano", symbol: "$", region: "latam" },
  { code: "CRC", label: "Colón costarricense", symbol: "₡", region: "latam" },
  { code: "CUP", label: "Peso cubano", symbol: "$", region: "latam" },
  { code: "DOP", label: "Peso dominicano", symbol: "RD$", region: "latam" },
  { code: "GTQ", label: "Quetzal", symbol: "Q", region: "latam" },
  { code: "HNL", label: "Lempira", symbol: "L", region: "latam" },
  { code: "HTG", label: "Gourde haitiano", symbol: "G", region: "latam" },
  { code: "MXN", label: "Peso mexicano", symbol: "$", region: "latam" },
  { code: "NIO", label: "Córdoba", symbol: "C$", region: "latam" },
  { code: "PAB", label: "Balboa", symbol: "B/.", region: "latam" },
  { code: "PEN", label: "Sol peruano", symbol: "S/", region: "latam" },
  { code: "PYG", label: "Guaraní", symbol: "₲", region: "latam" },
  { code: "UYU", label: "Peso uruguayo", symbol: "$U", region: "latam" },
  { code: "VES", label: "Bolívar venezolano", symbol: "Bs.", region: "latam" },
  { code: "USD", label: "Dólar estadounidense", symbol: "$", region: "other" },
  { code: "EUR", label: "Euro", symbol: "€", region: "other" },
  { code: "GBP", label: "Libra esterlina", symbol: "£", region: "other" },
  { code: "INR", label: "Rupia india", symbol: "₹", region: "other" },
  { code: "AUD", label: "Dólar australiano", symbol: "A$", region: "other" },
  { code: "CAD", label: "Dólar canadiense", symbol: "C$", region: "other" },
  { code: "JPY", label: "Yen japonés", symbol: "¥", region: "other" },
  { code: "CNY", label: "Yuan chino", symbol: "¥", region: "other" },
  { code: "AED", label: "Dírham de EAU", symbol: "د.إ", region: "other" },
  { code: "ZAR", label: "Rand sudafricano", symbol: "R", region: "other" },
  { code: "NGN", label: "Naira nigeriana", symbol: "₦", region: "other" },
  { code: "SGD", label: "Dólar de Singapur", symbol: "S$", region: "other" },
];

export function currenciesInRegion(
  region: CurrencyRegion,
): CurrencyOption[] {
  return CURRENCIES.filter((c) => c.region === region);
}

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked to the dollar across
 * the app. `currency` defaults to USD so callers with nothing better
 * stay safe, but pass the account/deal currency wherever known.
 *
 * Total by design: `Intl.NumberFormat` throws a RangeError on a
 * structurally invalid currency code, and `deals.currency` carries
 * NO DB CHECK (only `accounts.default_currency` does), so legacy
 * rows, imports, or hand-edited data can hold malformed values like
 * "United States". We never let that crash a render — on a bad code
 * we fall back to "CODE 1,234".
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Invalid ISO code — show the raw code + grouped number so the
    // value is still legible instead of throwing.
    return `${code} ${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/**
 * Compact currency for tight spaces (donut center, legend rows):
 * "$1.2M" / "€34.5k" / "₹900". Uses the currency's symbol from
 * CURRENCIES, falling back to the code when we don't carry a symbol.
 */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY,
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  return `${symbol}${formatCompactNumber(value)}`;
}

/**
 * Compact number for tight spaces (chart tiles, legends): 1_234 → "1.2k",
 * 1_200_000 → "1.2M", 900 → "900". The unit-less core shared with
 * {@link formatCurrencyShort}.
 */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
