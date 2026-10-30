// The one route on this server that answers without a credential.
//
// It exists so a workspace can hand something to the outside world that only
// speaks HTTP — a Google Business Profile post fetching its own header image,
// a client opening a report, a webhook consumer pulling a CSV. The token in
// the URL *is* the authorisation, so this handler is deliberately dull: it
// resolves, it streams, and it says nothing else.
//
// Every failure is the same 404. Distinguishing "no such token" from "expired"
// from "revoked" would confirm to an unauthenticated caller that a token was
// once real, which is the only thing a guesser could learn here.

import { NextRequest } from "next/server";
import { resolveShare } from "@/platform/shares.ts";
import { rateLimit } from "@/platform/cache";
import { clientIp } from "@/server/limits";

/**
 * Flood control (30 Oct 2026). This is the one route with no credential, and
 * it sits outside the /api gate's limits, so nothing counted it: a public
 * link fetched in a loop cost the pod a read per request. Two counts, either
 * can refuse — per caller, where a trusted proxy names one (clientIp: never
 * a header anyone can send), and per link, which is what bounds a flood when
 * no caller can be told apart. The per-link count is wide on purpose: a
 * header image in a sent newsletter is fetched by every reader.
 */
const SHARE_LIMITS = {
  perIp: { limit: 120, windowSec: 60 },
  perToken: { limit: 1200, windowSec: 60 },
} as const;

async function limited(req: NextRequest, token: string): Promise<Response | null> {
  const ip = clientIp(req);
  const verdicts = await Promise.all([
    ip ? rateLimit(`share:ip:${ip}`, SHARE_LIMITS.perIp.limit, SHARE_LIMITS.perIp.windowSec) : null,
    rateLimit(`share:token:${token.slice(0, 64)}`, SHARE_LIMITS.perToken.limit, SHARE_LIMITS.perToken.windowSec),
  ]);
  const over = verdicts.find((v) => v && !v.allowed);
  if (!over) return null;
  return new Response("Too many requests", {
    status: 429,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": String(over.retryAfter) },
  });
}

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

function headersFor(contentType: string, size: number) {
  return {
    "content-type": contentType,
    "content-length": String(size),
    // Never stored by a shared cache (30 Oct 2026). This was "public,
    // max-age=3600, immutable" for a link with no expiry and "public,
    // max-age=300" otherwise, so a CDN edge kept serving a link for up to an
    // hour after it was revoked or expired — and "the bytes never change" was
    // never true either: the path behind a token is one an agent can rewrite.
    // Revoking has to mean the next fetch is a 404.
    "cache-control": "private, no-store",
    // This origin serves other people's files. Never let a browser decide a
    // .txt is really HTML, and never let it run as a page.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    // A public link is not a place to leak where it was opened from.
    "referrer-policy": "no-referrer",
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const refused = await limited(req, token);
  if (refused) return refused;
  const hit = await resolveShare(token);
  if (!hit) return notFound();

  // From the folder, or from the file store where uploads live — streamed
  // (30 Oct 2026). It was read whole into memory per request, so twenty
  // parallel fetches of a 1 GB video held 20 GB on the pod.
  const opened = await hit.open().catch(() => null);
  if (!opened) return notFound(); // deleted between resolve and read
  return new Response(opened.body, {
    status: 200,
    headers: headersFor(hit.share.contentType, opened.size),
  });
}

/** Fetchers routinely HEAD before they GET; answering it saves them a round trip.
 *  A stat or a HEAD to the store for the length — never the bytes. */
export async function HEAD(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const refused = await limited(req, token);
  if (refused) return refused;
  const hit = await resolveShare(token);
  if (!hit) return notFound();
  const size = await hit.size().catch(() => null);
  if (size === null) return notFound();
  return new Response(null, {
    status: 200,
    headers: headersFor(hit.share.contentType, size),
  });
}
