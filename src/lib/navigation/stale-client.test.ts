import { describe, expect, it } from "vitest";

import { isStaleClientError } from "./stale-client";

describe("isStaleClientError", () => {
  it("detects webpack / turbopack chunk failures", () => {
    const chunk = new Error("Loading chunk 5760 failed.");
    chunk.name = "ChunkLoadError";
    expect(isStaleClientError(chunk)).toBe(true);
    expect(
      isStaleClientError(
        new Error("Failed to fetch dynamically imported module: /_next/static/chunks/app.js"),
      ),
    ).toBe(true);
  });

  it("detects RSC / HTML-instead-of-JS after a deploy", () => {
    expect(isStaleClientError(new Error("Failed to fetch RSC payload"))).toBe(
      true,
    );
    expect(isStaleClientError(new Error("Unexpected token '<'"))).toBe(true);
  });

  it("ignores ordinary application errors", () => {
    expect(isStaleClientError(new Error("Conversation not found"))).toBe(false);
    expect(isStaleClientError(null)).toBe(false);
  });
});
