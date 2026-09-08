const RELOAD_FLAG = "wacrm:stale-client-reload";

/**
 * True when the failure is almost certainly a stale tab after a
 * deploy: the HTML still points at JS/CSS chunks that the new build
 * no longer serves. A full reload fetches fresh HTML and recovers;
 * `reset()` / client navigation cannot, because the chunk map is
 * already wrong.
 */
export function isStaleClientError(error: unknown): boolean {
  if (error == null) return false;
  const name =
    typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  const text = `${name} ${message}`;
  return /ChunkLoadError|Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Failed to fetch RSC|Invalid or unexpected token|Unexpected token '<'|Loading CSS chunk|CSS chunk load error/i.test(
    text,
  );
}

/** Reload at most once per tab session so a real bug cannot loop. */
export function reloadOnceIfStale(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!isStaleClientError(error)) return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") return false;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // sessionStorage can throw; still reload — stuck is worse.
  }
  window.location.reload();
  return true;
}

/** Call after a successful dashboard mount so a later deploy can recover. */
export function clearStaleReloadFlag(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignore
  }
}
