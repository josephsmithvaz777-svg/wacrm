import {
  normalizeEmail,
  normalizePassword,
  normalizePersonName,
} from "@/lib/auth/auth-mail";

export type ManualMemberRole = "admin" | "agent" | "viewer";

export type ParsedManualMember =
  | {
      ok: true;
      fullName: string;
      email: string;
      password: string;
      role: ManualMemberRole;
    }
  | { ok: false; error: "invalid" };

export function parseManualMember(body: unknown): ParsedManualMember {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid" };
  const record = body as Record<string, unknown>;
  const fullName = normalizePersonName(record.fullName);
  const email = normalizeEmail(record.email);
  const password = normalizePassword(record.password);
  const role = record.role;
  if (!fullName || !email || !password) return { ok: false, error: "invalid" };
  if (role !== "admin" && role !== "agent" && role !== "viewer") {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, fullName, email, password, role };
}
