// POST /api/auth/signup
//
// Creates the auth user via the admin API and emails the confirmation
// link through Resend. The browser signup form used to call
// `supabase.auth.signUp`, which asks Supabase to send the mail itself.
// That built-in mailer is capped at a handful of messages per hour and
// the confirmation often never arrives.

import { NextResponse } from "next/server";

import { rollbackFreshUser } from "@/lib/auth/attach-member";
import {
  clientIp,
  confirmationCallbackUrl,
  localeFromRequest,
  normalizeEmail,
  normalizePassword,
  normalizePersonName,
  requestPublicOrigin,
  signupConfirmationMail,
  signupNextPath,
} from "@/lib/auth/auth-mail";
import {
  issueSignupConfirmation,
  type SignupLinkResult,
} from "@/lib/auth/signup-link";
import { sendPlainEmail } from "@/lib/email/send";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(`auth:signup:${ip}`, RATE_LIMITS.authSignup);
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  const body = (await request.json().catch(() => null)) as
    | {
        email?: unknown;
        password?: unknown;
        fullName?: unknown;
        inviteToken?: unknown;
      }
    | null;

  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);
  const fullName = normalizePersonName(body?.fullName);
  if (!email || !password || !fullName) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const emailLimit = checkRateLimit(
    `auth:signup-email:${email}`,
    RATE_LIMITS.authSignup,
  );
  if (!emailLimit.success) return rateLimitResponse(emailLimit);

  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[POST /api/auth/signup] RESEND_API_KEY is not set");
    return NextResponse.json({ error: "email_not_configured" }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const issued = await issueSignupConfirmation(
    {
      generateLink: async (params) => {
        const { data, error } = await admin.auth.admin.generateLink(
          params.type === "signup"
            ? {
                type: "signup",
                email: params.email,
                password: params.password ?? "",
                options: { data: params.options?.data },
              }
            : { type: "magiclink", email: params.email },
        );
        const mapped: SignupLinkResult = {
          data: data
            ? {
                properties: data.properties
                  ? {
                      hashed_token: data.properties.hashed_token,
                      verification_type: data.properties.verification_type,
                    }
                  : undefined,
                user: data.user
                  ? {
                      id: data.user.id,
                      email_confirmed_at: data.user.email_confirmed_at,
                      user_metadata: data.user.user_metadata,
                    }
                  : undefined,
              }
            : null,
          error: error
            ? { message: error.message, code: error.code, status: error.status }
            : null,
        };
        return mapped;
      },
      updateUserById: (id, attrs) => admin.auth.admin.updateUserById(id, attrs),
    },
    { email, password, fullName },
  );

  if (!issued.ok) {
    if (issued.reason === "taken") {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    console.error("[POST /api/auth/signup] issue link:", issued.message);
    if (issued.createdUserId) {
      await rollbackFreshUser(admin, issued.createdUserId);
    }
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }

  const origin = requestPublicOrigin(request);
  const url = confirmationCallbackUrl({
    origin,
    tokenHash: issued.tokenHash,
    type: issued.type,
    nextPath: signupNextPath(body?.inviteToken),
  });
  const mail = signupConfirmationMail(localeFromRequest(request), fullName, url);
  const sent = await sendPlainEmail({ to: email, ...mail });

  if (!sent.ok) {
    console.error("[POST /api/auth/signup] resend:", sent.error);
    if (issued.createdUserId) {
      await rollbackFreshUser(admin, issued.createdUserId);
    }
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }

  if (!issued.createdUserId) {
    // Second attempt on an unconfirmed account: the auth metadata
    // was updated, but the profile row still has the first name.
    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("email", email);
    if (profileError) {
      console.warn("[POST /api/auth/signup] profile name:", profileError.message);
    }
  }

  return NextResponse.json({ ok: true });
}
