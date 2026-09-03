import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_SOUND_MAX_BYTES,
  isNotificationSoundFile,
  notificationSoundSource,
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
