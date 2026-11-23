import { describe, expect, it } from "vitest";

import { membersForInboxFilter } from "./members";
import type { AccountMember } from "@/types";

function member(partial: Pick<AccountMember, "user_id" | "full_name" | "role">): AccountMember {
  return {
    email: null,
    avatar_url: null,
    joined_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("membersForInboxFilter", () => {
  it("keeps viewers who already own chats and sorts by name", () => {
    const result = membersForInboxFilter([
      member({ user_id: "1", full_name: "Jimena", role: "viewer" }),
      member({ user_id: "2", full_name: "Brenda", role: "agent" }),
      member({ user_id: "3", full_name: "Isaac", role: "viewer" }),
    ]);

    expect(result.map((m) => m.full_name)).toEqual(["Brenda", "Isaac", "Jimena"]);
  });
});
