// What this install is running. Open, like /api/healthz: a CLI asks it before
// it has a key (`foldrun version`), and a dashboard tab polls it to notice a
// deploy. A stranger gets the release's name and the API's date — both are
// also in every response's X-Foldrun-Version / X-Foldrun-Api headers, which
// the CLI's version check needs before it signs in. The commit shas, the
// release time, the packages and the runner's engines go to a caller with a
// key, a session or the scraper's token (server/probe-access.ts). Nothing
// here is about any account.
//
// `urls` (21 Nov 2026, one API): where this install answers programs and
// where people sign in — { api, app }. A CLI that signed in at the
// dashboard's address moves its calls to `api` and keeps `app` for the
// pages it opens and the few routes the API host leaves to the dashboard
// (server/api-host.ts). Both are public addresses, open like the name.

import { NextRequest, NextResponse } from "next/server";
import { mayReadProbeDetail } from "@/server/probe-access";
import { versionInfo } from "@/server/release";
import { apiOrigin, installOrigin } from "@/server/auth-flows";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const info = versionInfo();
  const urls = { api: apiOrigin(), app: installOrigin() };
  const body = (await mayReadProbeDetail(req)) ? { ...info, urls } : { version: info.version, api: info.api, urls };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
