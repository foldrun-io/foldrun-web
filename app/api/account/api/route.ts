import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requireAccountWide, errorResponse } from "@/server/api";
import { updateAdminState } from "@/platform/admin";
import { forgetAccountProfile } from "@/server/api-limits";
import { parseVersion } from "@/server/api-version";
import { apiFactsFor } from "@/server/api-facts";

// How this account meets the HTTP API: its rate limits, the API version
// its requests get when they send no Foldrun-Version header, and its use of
// the API over the last 30 days (versions, and deprecated routes it calls).
//
//   GET                         { version: {…}, limits: {…}, usage: {…} | null, usageHidden? }
//   PATCH { version: "YYYY-MM-DD" | null }   pin, or unpin (null → current)

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // Who calls which route is the whole account's: shown to a caller with
    // every workspace (apiFactsFor).
    return NextResponse.json(await apiFactsFor(tenant, actor.workspaces));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // The pin is every key's in the account: a caller scoped to some
    // workspaces would change what the others' CI receives (30 Oct 2026).
    const { tenant, actor } = await requireAccountWide(req, "keys:manage");
    const body = (await req.json()) as { version?: unknown };
    if (!("version" in (body ?? {}))) return NextResponse.json({ error: "expected { version: \"YYYY-MM-DD\" | null }" }, { status: 400 });
    let version: string | undefined;
    if (body.version !== null) {
      const parsed = parseVersion(typeof body.version === "string" ? body.version : String(body.version));
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      version = parsed.version ?? undefined;
    }
    await updateAdminState(tenant, { apiVersion: version }, actor.name, "api-version", { version: version ?? null });
    forgetAccountProfile(tenant);
    return NextResponse.json(await apiFactsFor(tenant));
  } catch (err) {
    return errorResponse(err);
  }
}
