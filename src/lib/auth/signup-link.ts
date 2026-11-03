// Mint a signup confirmation token without sending Supabase's email.
//
// `generateLink({ type: 'signup' })` creates the auth user (and the
// profile trigger runs) and returns a hashed token. If that email
// already exists and is still unconfirmed — the usual "the mail never
// arrived, they tried again" case — we update the password they just
// typed and mint a magic link instead. A confirmed account is left
// alone so signup cannot become a password reset.

import {
  isAuthCallbackType,
  isEmailTakenError,
  type AuthCallbackType,
} from "@/lib/auth/auth-mail";

export interface SignupLinkUser {
  id?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
}

export interface SignupLinkResult {
  data: {
    properties?: { hashed_token?: string; verification_type?: string };
    user?: SignupLinkUser;
  } | null;
  error: { message?: string; code?: string; status?: number } | null;
}

export interface SignupLinkAuth {
  generateLink(params: {
    type: "signup" | "magiclink";
    email: string;
    password?: string;
    options?: { data?: { full_name: string } };
  }): Promise<SignupLinkResult>;
  updateUserById(
    id: string,
    attrs: { password: string; user_metadata: Record<string, unknown> },
  ): Promise<{ error: { message?: string } | null }>;
}

export type IssuedSignupLink =
  | {
      ok: true;
      tokenHash: string;
      type: Extract<AuthCallbackType, "signup" | "magiclink">;
      /** Set only when this call created the auth user, so a failed send can roll it back. */
      createdUserId: string | null;
    }
  | {
      ok: false;
      reason: "taken" | "failed";
      createdUserId: string | null;
      message?: string;
    };

function tokenFrom(
  data: SignupLinkResult["data"],
  fallback: "signup" | "magiclink",
): { tokenHash: string; type: "signup" | "magiclink" } | null {
  const tokenHash = data?.properties?.hashed_token?.trim();
  if (!tokenHash) return null;
  const raw = data?.properties?.verification_type ?? fallback;
  const type = isAuthCallbackType(raw) && (raw === "signup" || raw === "magiclink")
    ? raw
    : fallback;
  return { tokenHash, type };
}

export async function issueSignupConfirmation(
  auth: SignupLinkAuth,
  input: { email: string; password: string; fullName: string },
): Promise<IssuedSignupLink> {
  const created = await auth.generateLink({
    type: "signup",
    email: input.email,
    password: input.password,
    options: { data: { full_name: input.fullName } },
  });

  if (!created.error) {
    const token = tokenFrom(created.data, "signup");
    const createdUserId = created.data?.user?.id ?? null;
    if (!token) {
      return {
        ok: false,
        reason: "failed",
        createdUserId,
        message: "Signup link did not include a token",
      };
    }
    return {
      ok: true,
      tokenHash: token.tokenHash,
      type: token.type,
      createdUserId,
    };
  }

  if (!isEmailTakenError(created.error)) {
    return {
      ok: false,
      reason: "failed",
      createdUserId: null,
      message: created.error.message,
    };
  }

  const existing = await auth.generateLink({
    type: "magiclink",
    email: input.email,
  });
  if (existing.error || !existing.data?.user?.id) {
    return {
      ok: false,
      reason: "failed",
      createdUserId: null,
      message: existing.error?.message ?? "Could not look up the existing user",
    };
  }

  if (existing.data.user.email_confirmed_at) {
    return { ok: false, reason: "taken", createdUserId: null };
  }

  const userId = existing.data.user.id;
  const updated = await auth.updateUserById(userId, {
    password: input.password,
    user_metadata: {
      ...(existing.data.user.user_metadata ?? {}),
      full_name: input.fullName,
    },
  });
  if (updated.error) {
    return {
      ok: false,
      reason: "failed",
      createdUserId: null,
      message: updated.error.message,
    };
  }

  const fresh = await auth.generateLink({
    type: "magiclink",
    email: input.email,
  });
  const token = tokenFrom(fresh.data, "magiclink");
  if (fresh.error || !token) {
    return {
      ok: false,
      reason: "failed",
      createdUserId: null,
      message: fresh.error?.message ?? "Could not mint a confirmation link",
    };
  }

  return {
    ok: true,
    tokenHash: token.tokenHash,
    type: token.type,
    createdUserId: null,
  };
}
