// The release notes: the newest releases, each with what changed since the
// one before, grouped Features / Fixes / Docs / Other from commit subjects.
// Behind a key or a session, unlike /api/version: commit subjects describe
// the platform's insides, which is a customer's business and not a
// stranger's.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { intParam } from "@/server/query";
import { releases, versionInfo } from "@/server/release";
import { apiChangelog } from "@/server/api-version";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireTenant(req);
    const limit = intParam(req.nextUrl.searchParams.get("limit"), 10, 1, 50);
    return NextResponse.json({ version: versionInfo().version, api: apiChangelog(), releases: releases(limit) });
  } catch (err) {
    return errorResponse(err);
  }
}
