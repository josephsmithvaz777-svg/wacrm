import { type AccountRole, hasMinRole } from "@/lib/auth/roles";

/**
 * True when this member must only see their own tasks (agents /
 * viewers with the account flag on). Owner and admin always see
 * the full board unless they opt into a personal filter in the UI.
 */
export function shouldLockTasksToSelf(
  role: AccountRole | null,
  restrictAgentTasks: boolean,
): boolean {
  if (!role || !restrictAgentTasks) return false;
  return !hasMinRole(role, "admin");
}

/**
 * Which assignee the leads board should load.
 * `null` means every agent. A user id limits the board to that person.
 * Agents start on their own tasks; owner and admin start on everyone.
 */
export function resolveTaskAgentFilter(args: {
  lockToSelf: boolean;
  selfId: string | null;
  isAgent: boolean;
  agentFilter: string | "all" | null;
}): string | null {
  if (args.lockToSelf) return args.selfId;
  if (args.agentFilter === "all") return null;
  if (args.agentFilter) return args.agentFilter;
  if (args.isAgent) return args.selfId;
  return null;
}

/** Match the RLS rule: assigned to me, or unassigned and I created it. */
export function isOwnLeadTask(
  task: { assigned_to?: string | null; created_by?: string | null },
  userId: string,
): boolean {
  if (task.assigned_to) return task.assigned_to === userId;
  return task.created_by === userId;
}
