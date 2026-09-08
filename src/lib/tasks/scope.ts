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

/** Match the RLS rule: assigned to me, or unassigned and I created it. */
export function isOwnLeadTask(
  task: { assigned_to?: string | null; created_by?: string | null },
  userId: string,
): boolean {
  if (task.assigned_to) return task.assigned_to === userId;
  return task.created_by === userId;
}
