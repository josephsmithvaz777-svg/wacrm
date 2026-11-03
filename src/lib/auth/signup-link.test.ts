import { describe, expect, it } from "vitest";

import {
  issueSignupConfirmation,
  type SignupLinkAuth,
  type SignupLinkResult,
} from "./signup-link";

function okLink(
  type: "signup" | "magiclink",
  token: string,
  user: SignupLinkResult["data"] extends infer D
    ? D extends { user?: infer U }
      ? U
      : never
    : never,
): SignupLinkResult {
  return {
    data: {
      properties: { hashed_token: token, verification_type: type },
      user,
    },
    error: null,
  };
}

describe("issueSignupConfirmation", () => {
  it("returns the signup token for a new user", async () => {
    const calls: string[] = [];
    const auth: SignupLinkAuth = {
      generateLink: async (params) => {
        calls.push(params.type);
        return okLink("signup", "token-new", { id: "user-1" });
      },
      updateUserById: async () => {
        throw new Error("should not update a new user");
      },
    };

    const issued = await issueSignupConfirmation(auth, {
      email: "ana@example.com",
      password: "secret1",
      fullName: "Ana",
    });

    expect(calls).toEqual(["signup"]);
    expect(issued).toEqual({
      ok: true,
      tokenHash: "token-new",
      type: "signup",
      createdUserId: "user-1",
    });
  });

  it("refuses a confirmed account without emailing a login link", async () => {
    let mailed = false;
    const auth: SignupLinkAuth = {
      generateLink: async (params) => {
        if (params.type === "signup") {
          return {
            data: null,
            error: { code: "email_exists", message: "already registered" },
          };
        }
        mailed = true;
        return okLink("magiclink", "should-not-be-used", {
          id: "user-1",
          email_confirmed_at: "2026-01-01T00:00:00Z",
        });
      },
      updateUserById: async () => {
        throw new Error("should not change a confirmed user");
      },
    };

    const issued = await issueSignupConfirmation(auth, {
      email: "ana@example.com",
      password: "secret1",
      fullName: "Ana",
    });

    expect(issued).toEqual({
      ok: false,
      reason: "taken",
      createdUserId: null,
    });
    expect(mailed).toBe(true);
  });

  it("resends a link and updates the password when the account is unconfirmed", async () => {
    const tokens: string[] = [];
    const auth: SignupLinkAuth = {
      generateLink: async (params) => {
        if (params.type === "signup") {
          return {
            data: null,
            error: { code: "email_exists", message: "already registered" },
          };
        }
        const token = `magic-${tokens.length + 1}`;
        tokens.push(token);
        return okLink("magiclink", token, {
          id: "user-1",
          email_confirmed_at: null,
          user_metadata: { locale: "es" },
        });
      },
      updateUserById: async (_id, attrs) => {
        expect(attrs.password).toBe("new-secret");
        expect(attrs.user_metadata).toEqual({ locale: "es", full_name: "Ana" });
        return { error: null };
      },
    };

    const issued = await issueSignupConfirmation(auth, {
      email: "ana@example.com",
      password: "new-secret",
      fullName: "Ana",
    });

    expect(issued).toEqual({
      ok: true,
      tokenHash: "magic-2",
      type: "magiclink",
      createdUserId: null,
    });
  });
});
