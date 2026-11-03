// Auth emails (signup confirmation, password recovery, welcome)
// are sent through Resend. Supabase's built-in mailer is rate-limited
// and frequently never reaches the inbox, so the app mints the
// verification token with the admin API and delivers the link itself.
// The link points at /auth/callback, which exchanges `token_hash`
// for a session cookie. That path does not depend on Supabase's
// redirect allow-list.

import { resolveLocale, type AppLocale } from "@/i18n/config";

const CALLBACK_TYPES = ["signup", "invite", "magiclink", "recovery", "email"] as const;
export type AuthCallbackType = (typeof CALLBACK_TYPES)[number];

export function isAuthCallbackType(value: string): value is AuthCallbackType {
  return (CALLBACK_TYPES as readonly string[]).includes(value);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) return null;
  return name;
}

/** Supabase stores passwords with bcrypt, which ignores bytes past 72. */
export function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 6 || value.length > 72) return null;
  return value;
}

/**
 * Where the confirmation link should land after the session is set.
 * Invite tokens are the same base64url alphabet as invite links; anything
 * else falls back to the dashboard so a crafted `next` cannot redirect
 * off-site.
 */
export function signupNextPath(inviteToken: unknown): string {
  if (typeof inviteToken !== "string") return "/dashboard";
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(inviteToken)) return "/dashboard";
  return `/join/${inviteToken}`;
}

export function confirmationCallbackUrl(opts: {
  origin: string;
  tokenHash: string;
  type: AuthCallbackType;
  nextPath: string;
}): string {
  const origin = opts.origin.replace(/\/+$/, "");
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("token_hash", opts.tokenHash);
  url.searchParams.set("type", opts.type);
  const next =
    opts.nextPath.startsWith("/") && !opts.nextPath.startsWith("//")
      ? opts.nextPath
      : "/dashboard";
  url.searchParams.set("next", next);
  return url.toString();
}

export function requestPublicOrigin(
  request: Request,
  siteUrl: string | null | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const explicit = siteUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

export function localeFromRequest(request: Request): AppLocale {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;)\s*NEXT_LOCALE=([^;]+)/);
  const preferred = match?.[1] ? safeDecode(match[1].trim()) : null;
  return resolveLocale(
    preferred,
    process.env.NEXT_PUBLIC_APP_LOCALE,
    request.headers.get("accept-language"),
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export function isEmailTakenError(
  error: { message?: string; code?: string; status?: number } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("email address is already")
  );
}

export function isUserMissingError(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "user_not_found") return true;
  return (error.message ?? "").toLowerCase().includes("not found");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface AuthMail {
  subject: string;
  text: string;
  html: string;
}

function linkBlock(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  return `<p><a href="${safeUrl}">${safeLabel}</a></p><p style="color:#64748b;font-size:13px;word-break:break-all">${safeUrl}</p>`;
}

export function signupConfirmationMail(
  locale: AppLocale,
  name: string,
  url: string,
): AuthMail {
  const safeName = escapeHtml(name);
  if (locale === "es") {
    return {
      subject: "Confirma tu cuenta",
      text: `Hola ${name},\n\nConfirma tu cuenta con este enlace:\n${url}\n\nSi no creaste esta cuenta, ignora este mensaje.`,
      html: `<p>Hola ${safeName},</p><p>Confirma tu cuenta para poder iniciar sesión.</p>${linkBlock("Confirmar cuenta", url)}<p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
    };
  }
  if (locale === "ko") {
    return {
      subject: "계정을 확인해 주세요",
      text: `안녕하세요 ${name}님,\n\n아래 링크로 계정을 확인해 주세요:\n${url}\n\n가입하지 않으셨다면 이 메일을 무시하세요.`,
      html: `<p>안녕하세요 ${safeName}님,</p><p>로그인하려면 계정을 확인해 주세요.</p>${linkBlock("계정 확인", url)}<p>가입하지 않으셨다면 이 메일을 무시하세요.</p>`,
    };
  }
  return {
    subject: "Confirm your account",
    text: `Hi ${name},\n\nConfirm your account with this link:\n${url}\n\nIf you did not create this account, you can ignore this message.`,
    html: `<p>Hi ${safeName},</p><p>Confirm your account to sign in.</p>${linkBlock("Confirm account", url)}<p>If you did not create this account, you can ignore this message.</p>`,
  };
}

export function recoveryMail(locale: AppLocale, url: string): AuthMail {
  if (locale === "es") {
    return {
      subject: "Restablece tu contraseña",
      text: `Recibimos una solicitud para restablecer tu contraseña.\n\nElige una nueva con este enlace:\n${url}\n\nSi no fuiste tú, ignora este mensaje.`,
      html: `<p>Recibimos una solicitud para restablecer tu contraseña.</p>${linkBlock("Restablecer contraseña", url)}<p>Si no fuiste tú, ignora este mensaje.</p>`,
    };
  }
  if (locale === "ko") {
    return {
      subject: "비밀번호를 재설정하세요",
      text: `비밀번호 재설정 요청을 받았습니다.\n\n아래 링크에서 새 비밀번호를 선택하세요:\n${url}\n\n본인이 아니라면 이 메일을 무시하세요.`,
      html: `<p>비밀번호 재설정 요청을 받았습니다.</p>${linkBlock("비밀번호 재설정", url)}<p>본인이 아니라면 이 메일을 무시하세요.</p>`,
    };
  }
  return {
    subject: "Reset your password",
    text: `We received a request to reset your password.\n\nChoose a new one with this link:\n${url}\n\nIf this was not you, you can ignore this message.`,
    html: `<p>We received a request to reset your password.</p>${linkBlock("Reset password", url)}<p>If this was not you, you can ignore this message.</p>`,
  };
}

export function welcomeMemberMail(
  locale: AppLocale,
  name: string,
  accountName: string,
  loginUrl: string,
): AuthMail {
  const safeName = escapeHtml(name);
  const safeAccount = escapeHtml(accountName);
  if (locale === "es") {
    return {
      subject: `Tu acceso a ${accountName} está listo`,
      text: `Hola ${name},\n\nUn administrador creó tu usuario en ${accountName}. Entra con el correo y la contraseña que te compartió:\n${loginUrl}`,
      html: `<p>Hola ${safeName},</p><p>Un administrador creó tu usuario en ${safeAccount}. Entra con el correo y la contraseña que te compartió.</p>${linkBlock("Iniciar sesión", loginUrl)}`,
    };
  }
  if (locale === "ko") {
    return {
      subject: `${accountName} 계정이 준비되었습니다`,
      text: `안녕하세요 ${name}님,\n\n관리자가 ${accountName}에 사용자를 만들었습니다. 전달받은 이메일과 비밀번호로 로그인하세요:\n${loginUrl}`,
      html: `<p>안녕하세요 ${safeName}님,</p><p>관리자가 ${safeAccount}에 사용자를 만들었습니다. 전달받은 이메일과 비밀번호로 로그인하세요.</p>${linkBlock("로그인", loginUrl)}`,
    };
  }
  return {
    subject: `Your access to ${accountName} is ready`,
    text: `Hi ${name},\n\nAn administrator created your user on ${accountName}. Sign in with the email and password they shared with you:\n${loginUrl}`,
    html: `<p>Hi ${safeName},</p><p>An administrator created your user on ${safeAccount}. Sign in with the email and password they shared with you.</p>${linkBlock("Sign in", loginUrl)}`,
  };
}
