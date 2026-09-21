// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  can_manage_staff_reminders?: boolean | null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // Prefer the designation column; if PostgREST/schema lag, fall back
    // so the Members tab still loads names (never blank the roster).
    let data: ProfileRow[] | null = null;
    const primary = await ctx.supabase
      .from("profiles")
      .select(
        "user_id, full_name, email, avatar_url, account_role, created_at, can_manage_staff_reminders",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (primary.error) {
      console.warn(
        "[GET /api/account/members] flag column unavailable, falling back:",
        primary.error.message,
      );
      const fallback = await ctx.supabase
        .from("profiles")
        .select(
          "user_id, full_name, email, avatar_url, account_role, created_at",
        )
        .eq("account_id", ctx.accountId)
        .order("created_at", { ascending: true });
      if (fallback.error) {
        console.error("[GET /api/account/members] fetch error:", fallback.error);
        return NextResponse.json(
          { error: "Failed to load members" },
          { status: 500 },
        );
      }
      data = fallback.data as ProfileRow[] | null;
    } else {
      data = primary.data as ProfileRow[] | null;
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = (data ?? []).flatMap((row) => {
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          can_manage_staff_reminders: Boolean(row.can_manage_staff_reminders),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
