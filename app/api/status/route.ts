// The platform's status, for anyone: the public status page, a customer's
// script, the dashboard's banner, `foldrun status`. Open on purpose — see
// server/status.ts — and cheap on purpose: a lease peek, a queue count, a
// database ping and the worker's latest five-minute sample, cached fifteen
// seconds (platform/status.ts). Never a provider call per request.
//
//   GET /api/status → { status, description, updatedAt, components[], incidents[], maintenance[] }

import { NextRequest, NextResponse } from "next/server";
import { currentStatus } from "@/platform/status";
import { statusPreflight, withStatusCors } from "@/server/status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const report = await currentStatus();
    const res = NextResponse.json(report);
    res.headers.set("cache-control", "public, max-age=15");
    return withStatusCors(req, res);
  } catch {
    // The status of the status: say it could not be worked out, in the same
    // shape, rather than a stack trace to a stranger.
    return withStatusCors(req, NextResponse.json({ status: "unknown", description: "Status could not be determined", components: [], incidents: [], maintenance: [] }, { status: 503 }));
  }
}

export function OPTIONS(req: NextRequest) {
  return statusPreflight(req);
}
