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
// `paths` (23 Nov 2026): the platform's and the models' path prefix there.

import { NextRequest, NextResponse } from "next/server";
import { mayReadProbeDetail } from "@/server/probe-access";
import { versionInfo } from "@/server/release";
import { apiOrigin, installOrigin } from "@/server/auth-flows";
import { V1_RENAMES } from "@/server/v1-path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const info = versionInfo();
  const urls = { api: apiOrigin(), app: installOrigin() };
  // Where programs call, under `urls.api` (23 Nov 2026, server/v1-path.ts).
  // The platform is under /v1 only where the API host's nginx maps it, which
  // the install says with FOLDRUN_API_V1=1 beside its FOLDRUN_PUBLIC_API_URL:
  // an address alone proves no such nginx, and a client sent to /v1 before
  // the mapping exists would lose a working /api (Codex review). Models are
  // at /v1 on the API host; with none, null — this address serves neither.
  // A client that finds no `paths` talks to an older install: /api.
  const v1 = Boolean(urls.api) && process.env.FOLDRUN_API_V1 === "1";
  const paths = { platform: v1 ? "/v1" : "/api", models: urls.api ? "/v1" : null, renames: v1 ? Object.fromEntries(V1_RENAMES.map(([to, from]) => [from, to])) : {} };
  const body = (await mayReadProbeDetail(req)) ? { ...info, urls, paths } : { version: info.version, api: info.api, urls, paths };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
