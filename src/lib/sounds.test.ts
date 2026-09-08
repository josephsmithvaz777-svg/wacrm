import { describe, expect, it } from "vitest";

import {
  ALERT_DEBOUNCE_MS,
  CUSTOM_SOUND_TIMEOUT_MS,
  NOTIFICATION_SOUND_MAX_BYTES,
  claimAlertSlot,
  isNotificationSoundFile,
  notificationSoundSource,
  resetAlertSlot,
} from "./sounds";

describe("notificationSoundSource", () => {
  it("is silent when the account sound is off", () => {
    expect(
      notificationSoundSource({ enabled: false, url: "https://x/a.mp3" }),
    ).toBe("silent");
  });

  it("uses a custom file when a url is set", () => {
    expect(
      notificationSoundSource({ enabled: true, url: "https://x/a.mp3" }),
    ).toBe("custom");
  });

  it("falls back to the built-in chime", () => {
    expect(notificationSoundSource({ enabled: true, url: null })).toBe(
      "default",
    );
    expect(notificationSoundSource({ enabled: true, url: "  " })).toBe(
      "default",
    );
  });

  it("gives up on a custom file in time to fall back", () => {
    expect(CUSTOM_SOUND_TIMEOUT_MS).toBeLessThanOrEqual(3000);
  });
});

describe("claimAlertSlot", () => {
  it("lets the first alert through and drops a second one in the same window", () => {
    resetAlertSlot();
    expect(claimAlertSlot(1_000)).toBe(true);
    expect(claimAlertSlot(1_000 + ALERT_DEBOUNCE_MS - 1)).toBe(false);
    expect(claimAlertSlot(1_000 + ALERT_DEBOUNCE_MS)).toBe(true);
  });
});

describe("isNotificationSoundFile", () => {
  it("accepts mp3 by mime or extension", () => {
    expect(
      isNotificationSoundFile({
        name: "ping.mp3",
        type: "audio/mpeg",
        size: 12_000,
      }),
    ).toBe(true);
    expect(
      isNotificationSoundFile({ name: "ping.mp3", type: "", size: 12_000 }),
    ).toBe(true);
  });

  it("rejects oversized or unknown files", () => {
    expect(
      isNotificationSoundFile({
        name: "ping.mp3",
        type: "audio/mpeg",
        size: NOTIFICATION_SOUND_MAX_BYTES + 1,
      }),
    ).toBe(false);
    expect(
      isNotificationSoundFile({ name: "note.txt", type: "text/plain", size: 10 }),
    ).toBe(false);
  });
});
