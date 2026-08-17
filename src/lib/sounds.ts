/**
 * Short UI chimes via Web Audio (no asset files). Browsers require a
 * prior user gesture before audio can play — call `unlockAudio()` from
 * a pointer/keydown handler once per session.
 */

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

/** Soft two-note chime for assignment / in-app notifications. */
export function playNotificationSound(): void {
  tone([880, 1175], { duration: 0.1, gain: 0.07, gap: 0.05 });
}

/** Single soft blip for inbound customer messages. */
export function playMessageSound(): void {
  tone([740], { duration: 0.09, gain: 0.06, type: "triangle" });
}
