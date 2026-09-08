import { describe, expect, it } from "vitest";

import { isOwnLeadTask, shouldLockTasksToSelf } from "./scope";

describe("shouldLockTasksToSelf", () => {
  it("locks agents and viewers when the account flag is on", () => {
    expect(shouldLockTasksToSelf("agent", true)).toBe(true);
    expect(shouldLockTasksToSelf("viewer", true)).toBe(true);
  });

  it("never locks owner or admin", () => {
    expect(shouldLockTasksToSelf("owner", true)).toBe(false);
    expect(shouldLockTasksToSelf("admin", true)).toBe(false);
  });

  it("does not lock anyone when the flag is off", () => {
    expect(shouldLockTasksToSelf("agent", false)).toBe(false);
    expect(shouldLockTasksToSelf("viewer", false)).toBe(false);
  });
});

describe("isOwnLeadTask", () => {
  it("matches the assignee when the task is assigned", () => {
    expect(
      isOwnLeadTask({ assigned_to: "agent-1", created_by: "admin-1" }, "agent-1"),
    ).toBe(true);
    expect(
      isOwnLeadTask({ assigned_to: "agent-1", created_by: "admin-1" }, "admin-1"),
    ).toBe(false);
  });

  it("falls back to the creator when unassigned", () => {
    expect(
      isOwnLeadTask({ assigned_to: null, created_by: "agent-1" }, "agent-1"),
    ).toBe(true);
    expect(
      isOwnLeadTask({ assigned_to: null, created_by: "agent-1" }, "agent-2"),
    ).toBe(false);
  });
});
