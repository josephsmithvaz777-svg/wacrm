import { describe, expect, it } from "vitest";
import { parseUuidList } from "./load-export-rows";

describe("parseUuidList", () => {
  it("parses a comma-separated list and de-dupes", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    expect(parseUuidList(`${a},${b},${a}`)).toEqual({
      ids: [a, b],
      invalid: false,
    });
  });

  it("treats empty as no filter", () => {
    expect(parseUuidList(null)).toEqual({ ids: [], invalid: false });
    expect(parseUuidList("  ")).toEqual({ ids: [], invalid: false });
  });

  it("flags garbage instead of silently dropping it", () => {
    expect(parseUuidList("not-a-uuid")).toEqual({ ids: [], invalid: true });
  });
});
