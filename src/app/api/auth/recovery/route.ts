// POST /api/auth/recovery
//
// Password-reset links go out through Resend, same as signup
// confirmation. Unknown addresses still return 200 so the form
// does not reveal which emails have an account.

import { NextResponse } from "next/server";

import {
  clientIp,
  confirmationCallbackUrl,
  isUserMissingError,
  localeFromRequest,
  normalizeEmail,
  recoveryMail,
  requestPublicOrigin,
} from "@/lib/auth/auth-mail";
import { sendPlainEmail } from "@/lib/email/send";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimit = checkRateLimit(
    `auth:recovery:${ip}`,
    RATE_LIMITS.authRecovery,
  );
  if (!ipLimit.success) return rateLimitResponse(ipLimit);

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown }
    | null;
  const email = normalizeEmail(body?.email);
  if (!email) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const emailLimit = checkRateLimit(
    `auth:recovery-email:${email}`,
    RATE_LIMITS.authRecovery,
  );
  if (!emailLimit.success) return rateLimitResponse(emailLimit);

  if (!process.env.RESEND_API_KEY?.trim()) {
    console.error("[POST /api/auth/recovery] RESEND_API_KEY is not set");
    return NextResponse.json({ error: "email_not_configured" }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error || !data?.properties?.hashed_token) {
    if (error && !isUserMissingError(error)) {
      console.error("[POST /api/auth/recovery] generateLink:", error.message);
    }
    return NextResponse.json({ ok: true });
  }

  const origin = requestPublicOrigin(request);
  const url = confirmationCallbackUrl({
    origin,
    tokenHash: data.properties.hashed_token,
    type: "recovery",
    nextPath: "/reset-password",
  });
  const mail = recoveryMail(localeFromRequest(request), url);
  const sent = await sendPlainEmail({ to: email, ...mail });
  if (!sent.ok) {
    console.error("[POST /api/auth/recovery] resend:", sent.error);
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
