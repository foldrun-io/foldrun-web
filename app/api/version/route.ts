// What this install is running. Open, like /api/healthz: a CLI asks it before
// it has a key (`foldrun version`), and a dashboard tab polls it to notice a
// deploy. It says what version and which commits — nothing about any account.

import { NextResponse } from "next/server";
import { versionInfo } from "@/server/release";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(versionInfo(), { headers: { "cache-control": "no-store" } });
}
