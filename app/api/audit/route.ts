// The account's audit log, for the account's own owner and admins.
//
// Until this route the log was written for every sign-in, key, invite and
// plan change and read by nobody but the platform's operator. An auditor asks the
// customer, not us, so the customer reads it here — and only their own:
// the tenant is the caller's, never a parameter.
//
//   GET /api/audit?since=7d&until=&action=apikey&actor=&workspace=&limit=100&cursor=&format=json|csv

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, ApiError } from "@/server/api";
import { queryAudit, auditCsv, parseWhen } from "@/server/audit";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "audit:read");
    // The log is the whole account's: who joined, which keys exist, what
    // the owner changed. A member scoped to some workspaces sees only
    // those everywhere else, so they do not get the account's log either.
    if (actor.workspaces !== null) throw new ApiError("the audit log covers the whole account — a member or key scoped to some workspaces cannot read it", 403);
    const p = req.nextUrl.searchParams;
    const format = p.get("format") ?? "json";
    if (format !== "json" && format !== "csv") throw new ApiError('format is "json" or "csv"', 400);
    const limitRaw = p.get("limit");
    const limit = limitRaw ? Number(limitRaw) : format === "csv" ? 1000 : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ApiError("limit is a whole number from 1 to 1000", 400);
    const page = await queryAudit({
      tenant,
      since: parseWhen(p.get("since")),
      until: parseWhen(p.get("until")),
      action: p.get("action") || undefined,
      actor: p.get("actor") || undefined,
      workspace: p.get("workspace") || undefined,
      cursor: p.get("cursor") || undefined,
      limit,
    });
    if (format === "csv") {
      return new NextResponse(auditCsv(page.entries), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="audit-${tenant}-${new Date().toISOString().slice(0, 10)}.csv"`,
          ...(page.next ? { "x-next-cursor": page.next } : {}),
        },
      });
    }
    return NextResponse.json({
      entries: page.entries,
      next: page.next,
      // Said with the data, so a caller never has to guess how far back it goes.
      retention: "kept for the life of the account",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
