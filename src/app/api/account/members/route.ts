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

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { attachFreshUser, rollbackFreshUser } from "@/lib/auth/attach-member";
import {
  isEmailTakenError,
  localeFromRequest,
  requestPublicOrigin,
  welcomeMemberMail,
} from "@/lib/auth/auth-mail";
import { parseManualMember } from "@/lib/auth/manual-member";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { sendPlainEmail } from "@/lib/email/send";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
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

// POST — admin creates a teammate directly. The account is confirmed
// immediately, so they can sign in with the password the admin chose
// even when the confirmation email never arrives. The welcome mail is
// best-effort and does not include the password.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsed = parseManualMember(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.fullName },
    });

    if (error || !data.user) {
      if (isEmailTakenError(error)) {
        return NextResponse.json({ error: "email_taken" }, { status: 409 });
      }
      console.error("[POST /api/account/members] createUser:", error?.message);
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }

    const userId = data.user.id;
    try {
      await attachFreshUser(admin, {
        userId,
        accountId: ctx.accountId,
        role: parsed.role,
        fullName: parsed.fullName,
        email: parsed.email,
      });
    } catch (attachError) {
      console.error("[POST /api/account/members] attach:", attachError);
      await rollbackFreshUser(admin, userId);
      const message =
        attachError instanceof Error ? attachError.message : "";
      if (message === "user_belongs_elsewhere") {
        return NextResponse.json({ error: "email_taken" }, { status: 409 });
      }
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }

    const loginUrl = `${requestPublicOrigin(request)}/login`;
    const mail = welcomeMemberMail(
      localeFromRequest(request),
      parsed.fullName,
      ctx.account.name,
      loginUrl,
    );
    const sent = await sendPlainEmail({ to: parsed.email, ...mail });
    if (!sent.ok) {
      console.warn("[POST /api/account/members] welcome email:", sent.error);
    }

    return NextResponse.json(
      {
        ok: true,
        emailSent: sent.ok,
        member: {
          user_id: userId,
          full_name: parsed.fullName,
          email: parsed.email,
          role: parsed.role,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
