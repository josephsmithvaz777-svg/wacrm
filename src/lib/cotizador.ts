/** Default public URL of the Altaterra lot-quote tool. */
export const DEFAULT_COTIZADOR_URL = "https://cotizador-altaterra.netlify.app/";

export function getCotizadorUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_COTIZADOR_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_COTIZADOR_URL;
}
