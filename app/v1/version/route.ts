// What this install is running. Open, like /v1/healthz: a CLI asks it before
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
import { addressFor, frontsFor, noticeForRequest } from "@/server/iran-front";
import { gatewayUrl } from "@/server/gateway-keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const info = versionInfo();
  // A caller in Iran is given the Iran front as its API (FOL-398), and —
  // to that caller only — every front and the operator's notice (FOL-402):
  // what `foldrun doctor` probes, the CLI's route switch checks a front
  // against, and Claude Code's status line moves its settings to. `gateway`
  // is where a key's model calls go (ANTHROPIC_BASE_URL), for this caller.
  const fronts = frontsFor(req);
  const urls = { api: addressFor(req, apiOrigin()), app: installOrigin(), gateway: gatewayUrl(req), ...(fronts.length ? { fronts } : {}) };
  const notice = noticeForRequest(req);
  // Every route is under /v1, at urls.api for programs (23 Nov 2026,
  // server/v1-path.ts): nothing to discover but the addresses.
  const body = (await mayReadProbeDetail(req)) ? { ...info, urls, ...(notice ? { notice } : {}) } : { version: info.version, api: info.api, urls, ...(notice ? { notice } : {}) };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
