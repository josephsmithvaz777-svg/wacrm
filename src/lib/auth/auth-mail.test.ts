import { describe, expect, it } from "vitest";

import {
  confirmationCallbackUrl,
  isEmailTakenError,
  normalizeEmail,
  normalizePassword,
  requestPublicOrigin,
  signupConfirmationMail,
  signupNextPath,
  welcomeMemberMail,
} from "./auth-mail";
import { parseManualMember } from "./manual-member";

describe("signupNextPath", () => {
  it("keeps a real invite token on the join path", () => {
    const token = "a".repeat(43);
    expect(signupNextPath(token)).toBe(`/join/${token}`);
  });

  it("ignores tokens that could change the redirect", () => {
    expect(signupNextPath("../login")).toBe("/dashboard");
    expect(signupNextPath("https://evil.example")).toBe("/dashboard");
    expect(signupNextPath("short")).toBe("/dashboard");
    expect(signupNextPath(undefined)).toBe("/dashboard");
  });
});

describe("confirmationCallbackUrl", () => {
  it("builds a same-origin callback with the hashed token", () => {
    const url = new URL(
      confirmationCallbackUrl({
        origin: "https://crm.example.com/",
        tokenHash: "abc+/=",
        type: "signup",
        nextPath: "/join/token",
      }),
    );
    expect(url.origin).toBe("https://crm.example.com");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("token_hash")).toBe("abc+/=");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/join/token");
  });

  it("drops an off-site next path", () => {
    const url = new URL(
      confirmationCallbackUrl({
        origin: "https://crm.example.com",
        tokenHash: "t",
        type: "recovery",
        nextPath: "https://evil.example",
      }),
    );
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });
});

describe("requestPublicOrigin", () => {
  it("prefers the configured site url", () => {
    const request = new Request("http://localhost:3000/api/auth/signup", {
      headers: { "x-forwarded-host": "spoof.example" },
    });
    expect(requestPublicOrigin(request, "https://crm.example.com/")).toBe(
      "https://crm.example.com",
    );
  });

  it("uses the forwarded host when no site url is set", () => {
    const request = new Request("http://internal/api/auth/signup", {
      headers: {
        "x-forwarded-host": "crm.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestPublicOrigin(request, "")).toBe("https://crm.example.com");
  });
});

describe("signup mail", () => {
  it("includes the confirmation link and escapes the name", () => {
    const mail = signupConfirmationMail(
      "es",
      "Ana <script>",
      "https://crm.example.com/auth/callback?token_hash=abc",
    );
    expect(mail.subject).toBe("Confirma tu cuenta");
    expect(mail.text).toContain("https://crm.example.com/auth/callback?token_hash=abc");
    expect(mail.html).toContain("Ana &lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
  });

  it("never puts a password in the welcome mail", () => {
    const mail = welcomeMemberMail(
      "es",
      "Ana",
      "Altaterra",
      "https://crm.example.com/login",
    );
    expect(mail.text).toContain("https://crm.example.com/login");
    expect(mail.text.toLowerCase()).not.toContain("contraseña:");
  });
});

describe("parseManualMember", () => {
  it("accepts an admin-created agent", () => {
    expect(
      parseManualMember({
        fullName: "  Ana Pérez  ",
        email: "Ana@Example.com",
        password: "secret1",
        role: "agent",
      }),
    ).toEqual({
      ok: true,
      fullName: "Ana Pérez",
      email: "ana@example.com",
      password: "secret1",
      role: "agent",
    });
  });

  it("rejects owner and a short password", () => {
    expect(
      parseManualMember({
        fullName: "Ana",
        email: "ana@example.com",
        password: "secret1",
        role: "owner",
      }).ok,
    ).toBe(false);
    expect(normalizePassword("12345")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("isEmailTakenError", () => {
  it("recognises Supabase's email_exists code", () => {
    expect(isEmailTakenError({ code: "email_exists", message: "nope" })).toBe(
      true,
    );
    expect(isEmailTakenError({ message: "Database down" })).toBe(false);
  });
});
