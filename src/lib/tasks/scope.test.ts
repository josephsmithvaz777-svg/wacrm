import { describe, expect, it } from "vitest";

import {
  isOwnLeadTask,
  resolveTaskAgentFilter,
  shouldLockTasksToSelf,
} from "./scope";

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

describe("resolveTaskAgentFilter", () => {
  it("shows every agent for an owner until they pick one", () => {
    expect(
      resolveTaskAgentFilter({
        lockToSelf: false,
        selfId: "owner-1",
        isAgent: false,
        agentFilter: null,
      }),
    ).toBeNull();
  });

  it("keeps an agent on their own tasks by default", () => {
    expect(
      resolveTaskAgentFilter({
        lockToSelf: false,
        selfId: "agent-1",
        isAgent: true,
        agentFilter: null,
      }),
    ).toBe("agent-1");
  });

  it("lets the owner narrow the board to one agent", () => {
    expect(
      resolveTaskAgentFilter({
        lockToSelf: false,
        selfId: "owner-1",
        isAgent: false,
        agentFilter: "agent-2",
      }),
    ).toBe("agent-2");
  });

  it("returns to every agent when the filter is cleared", () => {
    expect(
      resolveTaskAgentFilter({
        lockToSelf: false,
        selfId: "agent-1",
        isAgent: true,
        agentFilter: "all",
      }),
    ).toBeNull();
  });

  it("ignores a wider filter when the account locks agents to themselves", () => {
    expect(
      resolveTaskAgentFilter({
        lockToSelf: true,
        selfId: "agent-1",
        isAgent: true,
        agentFilter: "all",
      }),
    ).toBe("agent-1");
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
