// Daily uptime per component, oldest day first, and the incidents in the
// window — what the status page draws as 90-day bars. Open, like
// /api/status. Uptime is the share of five-minute samples that were not an
// outage; a day with no samples has no figure (null), not 100%.
//
//   GET /api/status/history?days=90   (1..90)

import { NextRequest, NextResponse } from "next/server";
import { statusHistory } from "@/platform/status";
import { statusPreflight, withStatusCors } from "@/server/status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("days");
  const days = raw === null ? 90 : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return withStatusCors(req, NextResponse.json({ error: "days is a whole number from 1 to 90" }, { status: 400 }));
  }
  try {
    const res = NextResponse.json(await statusHistory(days));
    res.headers.set("cache-control", "public, max-age=300");
    return withStatusCors(req, res);
  } catch {
    return withStatusCors(req, NextResponse.json({ error: "history unavailable" }, { status: 503 }));
  }
}

export function OPTIONS(req: NextRequest) {
  return statusPreflight(req);
}
