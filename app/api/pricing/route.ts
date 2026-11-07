// The public catalogue: plans and rates, for foldrun.io and foldrun.ir to read
// so their numbers can never drift from what is charged (FOL-125, FOL-127).
// Open on purpose — no session, no key, prices are public — with exact-origin
// CORS like /api/signup, an ETag and five minutes' cache.
//
//   GET /api/pricing → { version, creditUsd, plans, contact, meters, example, models }

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { billing } from "@/platform/billing";
import { refuse } from "@/server/api";
import { withOpenCors } from "@/server/status";
import { signupOrigins } from "@/server/signup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const catalogue = billing().catalogue?.();
    if (!catalogue) return withOpenCors(req, refuse("nothing is sold on this install", 404), signupOrigins());
    const body = JSON.stringify(catalogue);
    const etag = `"${crypto.createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
    const res = req.headers.get("if-none-match") === etag
      ? new NextResponse(null, { status: 304 })
      : new NextResponse(body, { status: 200, headers: { "content-type": "application/json" } });
    res.headers.set("etag", etag);
    res.headers.set("cache-control", "public, max-age=300");
    return withOpenCors(req, res, signupOrigins());
  } catch {
    // The margin cannot be read (settings down): say so, never a guessed price.
    const res = refuse("prices are unavailable right now", 503);
    res.headers.set("cache-control", "no-store");
    return withOpenCors(req, res, signupOrigins());
  }
}

export function OPTIONS(req: NextRequest) {
  return withOpenCors(req, new NextResponse(null, { status: 204 }), signupOrigins());
}
