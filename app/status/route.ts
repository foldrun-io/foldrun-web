// /status on the dashboard's own host: to the public status page, which is
// a static page on the site (and so still loads when this host does not).
// Open — the proxy's matcher does not cover it.

import { NextResponse } from "next/server";
import { statusPageUrl } from "@/server/status";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(statusPageUrl(), 307);
}
