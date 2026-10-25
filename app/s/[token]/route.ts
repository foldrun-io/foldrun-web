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

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

function headersFor(contentType: string, size: number, immutable: boolean) {
  return {
    "content-type": contentType,
    "content-length": String(size),
    // The bytes behind a token never change — a re-share mints a new token —
    // so a long cache is safe, but only for a link that will still exist.
    "cache-control": immutable ? "public, max-age=3600, immutable" : "public, max-age=300",
    // This origin serves other people's files. Never let a browser decide a
    // .txt is really HTML, and never let it run as a page.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    // A public link is not a place to leak where it was opened from.
    "referrer-policy": "no-referrer",
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const hit = await resolveShare(token);
  if (!hit) return notFound();

  // From the folder, or from the file store where uploads live.
  const bytes = await hit.read().catch(() => null);
  if (!bytes) return notFound(); // deleted between resolve and read
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: headersFor(hit.share.contentType, bytes.length, hit.share.expiresAt === null),
  });
}

/** Fetchers routinely HEAD before they GET; answering it saves them a round trip. */
export async function HEAD(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const hit = await resolveShare(token);
  if (!hit) return notFound();
  const bytes = await hit.read().catch(() => null);
  if (!bytes) return notFound();
  const size = bytes.length;
  return new Response(null, {
    status: 200,
    headers: headersFor(hit.share.contentType, size, hit.share.expiresAt === null),
  });
}
