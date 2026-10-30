// RFC 9116: where to report a vulnerability in this install. Open — the
// proxy's matcher does not cover /.well-known — and the same contact
// foldrun.io serves (server/security-txt.ts).

import { securityTxt } from "@/server/security-txt";
import { installOrigin } from "@/server/auth-flows";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  // X-Forwarded-Host only from a proxy the operator trusts, as publicOrigin
  // reads it: from anyone else it put `Canonical: https://evil.example/…` in
  // an answer a shared cache keeps for a day (30 Oct 2026). The Host header
  // is the request's own, and what a cache keys on.
  const forwarded = process.env.FOLDRUN_TRUST_PROXY === "1" ? req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : null;
  const host = forwarded || req.headers.get("host");
  const base = installOrigin() || (host ? `https://${host}` : null);
  const canonical = base ? `${base.replace(/\/$/, "")}/.well-known/security.txt` : undefined;
  return new Response(securityTxt(new Date(), canonical), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
