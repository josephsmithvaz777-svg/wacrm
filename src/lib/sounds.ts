export const NOTIFICATION_SOUND_MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_EXT = /\.(mp3|wav|ogg|m4a|aac|webm)$/i;

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/m4a",
]);

/** Give up on a custom file quickly so the built-in chime can still play. */
export const CUSTOM_SOUND_TIMEOUT_MS = 2500;

export function isNotificationSoundFile(file: {
  name: string;
  type: string;
  size: number;
}): boolean {
  if (file.size <= 0 || file.size > NOTIFICATION_SOUND_MAX_BYTES) return false;
  if (file.type && ALLOWED_MIME.has(file.type.toLowerCase())) return true;
  return ALLOWED_EXT.test(file.name);
}

export function notificationSoundSource(opts: {
  enabled: boolean;
  url?: string | null;
}): "silent" | "custom" | "default" {
  if (!opts.enabled) return "silent";
  const url = opts.url?.trim();
  return url ? "custom" : "default";
}

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  return sharedCtx;
}

/**
 * Resume the shared AudioContext. Browsers start it `suspended` until
 * a user gesture. `resume()` must be invoked in the same turn as the
 * click/keydown — wrapping it in an async IIFE first dropped the
 * gesture and left every chime silent.
 */
export function unlockAudio(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const ctx = getCtx();
  if (!ctx || ctx.state !== "suspended") return Promise.resolve();
  return ctx.resume().then(
    () => undefined,
    () => undefined,
  );
}

async function readyCtx(): Promise<AudioContext | null> {
  const ctx = getCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }
  return ctx.state === "running" ? ctx : null;
}

function connectAlertBus(ctx: AudioContext): AudioNode {
  const master = ctx.createGain();
  // Loud enough to hear across a desk, compressor keeps peaks from
  // clipping laptop speakers.
  master.gain.value = 0.72;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);
  return master;
}

function strike(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  t: number,
  duration: number,
  peak: number,
) {
  const body = ctx.createOscillator();
  const sparkle = ctx.createOscillator();
  const g = ctx.createGain();
  body.type = "sine";
  sparkle.type = "triangle";
  body.frequency.setValueAtTime(freq, t);
  sparkle.frequency.setValueAtTime(freq * 2, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(peak * 0.55, t + duration * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  body.connect(g);
  sparkle.connect(g);
  g.connect(dest);
  body.start(t);
  sparkle.start(t);
  body.stop(t + duration + 0.04);
  sparkle.stop(t + duration + 0.04);
}

/**
 * Original phone-style alert (not a copy of Apple/WhatsApp files):
 * a bright rising tri-tone at desk volume so an inbound lead is hard
 * to miss.
 */
async function playPhoneAlert(): Promise<void> {
  const ctx = await readyCtx();
  if (!ctx) return;
  const dest = connectAlertBus(ctx);
  let t = ctx.currentTime + 0.01;
  const notes = [880, 1175, 1568];
  const duration = 0.16;
  const gap = 0.05;
  for (const freq of notes) {
    strike(ctx, dest, freq, t, duration, 0.42);
    t += duration + gap;
  }
}

export function playCustomSoundUrl(url: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  void unlockAudio();

  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.onerror = null;
      audio.onplaying = null;
      if (!ok) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      resolve(ok);
    };

    const timer = window.setTimeout(
      () => finish(false),
      CUSTOM_SOUND_TIMEOUT_MS,
    );
    audio.preload = "auto";
    audio.volume = 1;
    audio.onerror = () => finish(false);
    audio.onplaying = () => finish(true);
    audio.src = url;
    void audio.play().catch(() => finish(false));
  });
}

export type NotificationSoundOpts = {
  /** Account-wide mute. Defaults to playing. */
  enabled?: boolean;
  /** Custom file URL. Empty/null uses the built-in chime. */
  url?: string | null;
};

/** A new lead fires both an assignment ping and a message ping. One alert. */
export const ALERT_DEBOUNCE_MS = 2200;

let lastAlertAt = 0;

export function claimAlertSlot(now = Date.now()): boolean {
  if (now - lastAlertAt < ALERT_DEBOUNCE_MS) return false;
  lastAlertAt = now;
  return true;
}

/** Test helper: do not use in UI. */
export function resetAlertSlot(): void {
  lastAlertAt = 0;
}

/** Assignment / in-app notification chime. */
export function playNotificationSound(opts: NotificationSoundOpts = {}): void {
  const source = notificationSoundSource({
    enabled: opts.enabled !== false,
    url: opts.url,
  });
  if (source === "silent") return;
  if (!claimAlertSlot()) return;
  void (async () => {
    if (source === "custom" && opts.url) {
      const played = await playCustomSoundUrl(opts.url.trim());
      if (played) return;
    }
    await playPhoneAlert();
  })();
}

/** Same loud phone alert for inbound customer messages / new leads. */
export function playMessageSound(): void {
  if (!claimAlertSlot()) return;
  void playPhoneAlert();
}
