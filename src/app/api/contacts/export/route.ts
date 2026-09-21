import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  contactsToCsvBuffer,
  exportFilename,
} from "@/lib/contacts/export-csv";
import {
  loadExportContacts,
  parseUuidList,
} from "@/lib/contacts/load-export-rows";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * GET /api/contacts/export
 *
 * Admin+ CSV dump of contacts (phone, name, tags, created date)
 * for building a campaign WhatsApp group. Honours the same tag /
 * agent / search filters as the Contacts page, or an explicit `ids`
 * list when the admin selected rows.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:contactsExport:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const idsParsed = parseUuidList(url.searchParams.get("ids"));
    const tagsParsed = parseUuidList(url.searchParams.get("tag_ids"));
    const agentsParsed = parseUuidList(url.searchParams.get("assigned_to"));
    if (idsParsed.invalid || tagsParsed.invalid || agentsParsed.invalid) {
      return NextResponse.json(
        { error: "ids, tag_ids and assigned_to must be UUID lists" },
        { status: 400 },
      );
    }

    const search = url.searchParams.get("search")?.trim() || null;
    const includeUnassigned =
      url.searchParams.get("include_unassigned") === "1" ||
      url.searchParams.get("include_unassigned") === "true";

    const rows = await loadExportContacts(ctx.supabase, {
      ids: idsParsed.ids,
      tagIds: tagsParsed.ids,
      assignedTo: agentsParsed.ids,
      includeUnassigned,
      search,
    });

    const filename = exportFilename();
    return new NextResponse(Buffer.from(contactsToCsvBuffer(rows)), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Export-Count": String(rows.length),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
