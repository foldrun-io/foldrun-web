// The status routes' shared edges: who may read them cross-origin, and where
// the public status page lives.
//
// GET /api/status and /api/status/history are open — no session, no key —
// because the page that shows them is a static page on another origin
// (foldrun.io/status), and because a status page that needs a login is no
// use on the day the login is what is broken. They say nothing an outsider
// can use: a level per component, a sentence, and what the operator posted.

import { NextResponse, type NextRequest } from "next/server";

/** The origins allowed to read the open status routes from a browser. */
export function statusOrigins(): string[] {
  const env = process.env.FOLDRUN_STATUS_ORIGINS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://foldrun.io", "https://www.foldrun.io", "https://status.foldrun.io"];
}

/** The public status page, for the dashboard's links. */
export function statusPageUrl(): string {
  return process.env.FOLDRUN_STATUS_PAGE_URL || "https://foldrun.io/status/";
}

/** CORS for an open GET: the allowed origin echoed, never `*` with
 *  credentials, and Vary so a cache does not hand one origin's answer to
 *  another. A request from anywhere else still gets the body — CORS only
 *  decides whether a browser lets the page read it. */
export function withStatusCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get("origin");
  if (origin && statusOrigins().includes(origin)) {
    res.headers.set("access-control-allow-origin", origin);
    res.headers.set("access-control-allow-methods", "GET, OPTIONS");
    res.headers.set("access-control-max-age", "600");
  }
  res.headers.append("vary", "Origin");
  return res;
}

export function statusPreflight(req: NextRequest): NextResponse {
  return withStatusCors(req, new NextResponse(null, { status: 204 }));
}
