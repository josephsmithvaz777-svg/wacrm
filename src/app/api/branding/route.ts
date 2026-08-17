import { NextResponse } from "next/server";

import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/**
 * GET /api/branding
 *
 * Public. Returns the workspace name + logo that an admin opted in
 * to show on /login and /signup (Settings → Branding).
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`branding:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_login_branding");

  if (error) {
    console.error("[branding] rpc error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json(data ?? { ok: false });
}
