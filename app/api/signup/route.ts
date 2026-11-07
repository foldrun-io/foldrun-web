// Can a stranger sign up here, and how? For foldrun.io's "Get started"
// buttons and plan cards, which are static pages on another origin, so open
// on purpose — no session, no key — with exact-origin CORS like the status
// routes (server/status.ts withOpenCors) and a minute's cache.
//
//   GET /api/signup → { free, paid, plans: [{ id, name, price: { amount, currency, interval }, credits, storageGb, vcpu, memoryGiB, priority }] }
//
// Advisory: POST /api/auth/signup asks the doors again, inside the users
// lock. `plans` lists only what the billing catalogue marks purchasable, and
// only while paid sign-up is in effect; the community edition answers
// { free, paid: false, plans: [] }. Nothing an outsider can use: two
// switches and prices that are public anyway (server/signup.ts).

import { NextRequest, NextResponse } from "next/server";
import { withOpenCors } from "@/server/status";
import { publicSignup, signupOrigins } from "@/server/signup";

// Read on every request: a build-time answer would freeze the switches.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const res = NextResponse.json(publicSignup());
    res.headers.set("cache-control", "public, max-age=60");
    return withOpenCors(req, res, signupOrigins());
  } catch {
    // The same shape with every door shut, never cached: the site shows its
    // fallback ("Get started" → the sign-up page, which tells the truth).
    const res = NextResponse.json({ free: false, paid: false, plans: [] }, { status: 503 });
    res.headers.set("cache-control", "no-store");
    return withOpenCors(req, res, signupOrigins());
  }
}

export function OPTIONS(req: NextRequest) {
  return withOpenCors(req, new NextResponse(null, { status: 204 }), signupOrigins());
}
