import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadExportContacts: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: { message?: string; status?: number }) =>
    Response.json(
      { error: err?.message ?? "auth failed" },
      { status: err?.status ?? 403 },
    ),
  ),
}));

vi.mock("@/lib/contacts/load-export-rows", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/contacts/load-export-rows")
  >("@/lib/contacts/load-export-rows");
  return {
    ...actual,
    loadExportContacts: mocks.loadExportContacts,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: "rate limited" }, { status: 429 }),
  ),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

import { GET } from "./route";

const context = {
  supabase: { name: "scoped-client" },
  accountId: "account-1",
  userId: "admin-1",
  role: "admin",
  account: { id: "account-1", name: "Acme" },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.loadExportContacts.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.requireRole.mockResolvedValue(context);
  mocks.checkRateLimit.mockReturnValue({ success: true });
  mocks.loadExportContacts.mockResolvedValue([
    {
      phone: "+51911111111",
      name: "Jimena",
      email: null,
      company: null,
      tags: ["Campaña agosto"],
      createdAt: "2026-08-02T12:00:00.000Z",
    },
  ]);
});

describe("/api/contacts/export", () => {
  it("requires admin and returns a CSV with tags and date", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/export"),
    );

    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const body = await response.text();
    expect(body).toContain("phone,name,email,company,tags,created_at");
    expect(body).toContain("+51911111111");
    expect(body).toContain("Campaña agosto");
    expect(response.headers.get("X-Export-Count")).toBe("1");
  });

  it("forwards tag filters so an August campaign dump stays scoped", async () => {
    const tagId = "11111111-1111-4111-8111-111111111111";
    await GET(
      new Request(
        `http://localhost/api/contacts/export?tag_ids=${tagId}&search=agosto`,
      ),
    );

    expect(mocks.loadExportContacts).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        tagIds: [tagId],
        search: "agosto",
      }),
    );
  });

  it("forwards a created_at window for a campaign dump", async () => {
    await GET(
      new Request(
        "http://localhost/api/contacts/export?created_from=2026-08-01&created_to=2026-08-31",
      ),
    );

    expect(mocks.loadExportContacts).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        createdFromYmd: "2026-08-01",
        createdToYmd: "2026-08-31",
      }),
    );
  });

  it("rejects a malformed created_from", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/export?created_from=agosto"),
    );
    expect(response.status).toBe(400);
    expect(mocks.loadExportContacts).not.toHaveBeenCalled();
  });

  it("rejects a malformed UUID list", async () => {
    const response = await GET(
      new Request("http://localhost/api/contacts/export?ids=not-a-uuid"),
    );
    expect(response.status).toBe(400);
    expect(mocks.loadExportContacts).not.toHaveBeenCalled();
  });
});
