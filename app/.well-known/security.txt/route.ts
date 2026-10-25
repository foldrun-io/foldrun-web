// RFC 9116: where to report a vulnerability in this install. Open — the
// proxy's matcher does not cover /.well-known — and the same contact
// foldrun.io serves (server/security-txt.ts).

import { securityTxt } from "@/server/security-txt";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const base = process.env.FOLDRUN_PUBLIC_URL || (host ? `https://${host}` : null);
  const canonical = base ? `${base.replace(/\/$/, "")}/.well-known/security.txt` : undefined;
  return new Response(securityTxt(new Date(), canonical), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
