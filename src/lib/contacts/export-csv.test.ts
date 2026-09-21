import { describe, expect, it } from "vitest";
import {
  contactsToCsv,
  csvCell,
  exportFilename,
  formatExportDate,
  formatExportTags,
} from "./export-csv";

describe("formatExportDate", () => {
  it("emits YYYY-MM-DD from an ISO timestamp", () => {
    expect(formatExportDate("2026-08-14T18:22:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("returns empty for garbage", () => {
    expect(formatExportDate("not-a-date")).toBe("");
  });
});

describe("csvCell", () => {
  it("leaves plain values unquoted", () => {
    expect(csvCell("Alice")).toBe("Alice");
  });

  it("quotes commas, quotes, and newlines", () => {
    expect(csvCell('Acme, "Inc"')).toBe('"Acme, ""Inc"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("formatExportTags", () => {
  it("joins with semicolons so re-import still splits", () => {
    expect(formatExportTags(["Agosto", "VIP"])).toBe("Agosto; VIP");
  });

  it("drops blanks", () => {
    expect(formatExportTags(["  ", "Lead", ""])).toBe("Lead");
  });
});

describe("contactsToCsv", () => {
  it("writes headers even with no rows", () => {
    expect(contactsToCsv([])).toBe(
      "phone,name,email,company,tags,created_at\r\n",
    );
  });

  it("includes tags and date for a campaign dump", () => {
    const csv = contactsToCsv([
      {
        phone: "+51911111111",
        name: "Jimena",
        email: "j@example.com",
        company: "Alterra",
        tags: ["Campaña agosto", "VIP"],
        createdAt: "2026-08-02T12:00:00.000Z",
      },
    ]);
    const [, row] = csv.trim().split("\r\n");
    expect(row).toContain("+51911111111");
    expect(row).toContain("Jimena");
    expect(row).toContain("Campaña agosto; VIP");
    expect(row).toMatch(/\d{4}-\d{2}-\d{2}$/);
  });
});

describe("exportFilename", () => {
  it("prefix is stable for WhatsApp-group downloads", () => {
    expect(exportFilename(new Date("2026-08-19T15:00:00"))).toMatch(
      /^contactos-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });
});
