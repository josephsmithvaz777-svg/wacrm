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
let fileAudio: HTMLAudioElement | null = null;

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

/** Resume the shared AudioContext after a user gesture. */
export function unlockAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

function tone(
  freqs: number[],
  {
    duration = 0.12,
    type = "sine" as OscillatorType,
    gain = 0.08,
    gap = 0.06,
  }: {
    duration?: number;
    type?: OscillatorType;
    gain?: number;
    gap?: number;
  } = {},
) {
  const ctx = getCtx();
  if (!ctx || ctx.state === "suspended") return;

  let t = ctx.currentTime;
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    t += duration + gap;
  }
}

function playFile(url: string): void {
  if (typeof window === "undefined") return;
  if (!fileAudio) fileAudio = new Audio();
  fileAudio.src = url;
  fileAudio.currentTime = 0;
  void fileAudio.play().catch(() => {
    // Autoplay blocked until a gesture; unlockAudio handles the next one.
  });
}

export type NotificationSoundOpts = {
  /** Account-wide mute. Defaults to playing. */
  enabled?: boolean;
  /** Custom file URL. Empty/null uses the built-in chime. */
  url?: string | null;
};

/** Assignment / in-app notification chime. */
export function playNotificationSound(opts: NotificationSoundOpts = {}): void {
  const source = notificationSoundSource({
    enabled: opts.enabled !== false,
    url: opts.url,
  });
  if (source === "silent") return;
  if (source === "custom" && opts.url) {
    playFile(opts.url.trim());
    return;
  }
  tone([880, 1175], { duration: 0.1, gain: 0.07, gap: 0.05 });
}

/** Single soft blip for inbound customer messages. */
export function playMessageSound(): void {
  tone([740], { duration: 0.09, gain: 0.06, type: "triangle" });
}
