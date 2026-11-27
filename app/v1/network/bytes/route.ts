// Bytes to test the road with (FOL-402, 27 Nov 2026): what `foldrun doctor`
// downloads and uploads, credential-free, to tell a filter that freezes big
// connections (Iran's, after ~20–30 KB to a little-known foreign name) from
// a platform that is down. Open, like /v1/healthz, and held to PER_IP calls
// a minute from one address (the API's own limit counts callers with a
// credential only), with an upload given UPLOAD_SECONDS to arrive.
//
//   GET  /v1/network/bytes?size=<1..65536>   that many random bytes
//   POST /v1/network/bytes                   up to 64 KiB in; { received }
//
// Random, so no compression on the way shrinks them below what is measured,
// and never cached anywhere: each answer is made for the call.

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/server/api";
import { rateLimit } from "@/platform/cache";
import { clientIp } from "@/server/limits";
import { FRONT_HEADER } from "@/server/iran-front";

export const dynamic = "force-dynamic";

/** The most either way: 64 KiB, past where the filter freezes a connection. */
const MAX_BYTES = 64 * 1024;

const NO_CACHE = { "cache-control": "no-store, no-transform", pragma: "no-cache" };

/** One doctor run asks 3 per address, at most 5 addresses: room for two runs. */
const PER_IP = { limit: 30, windowSec: 60 };
const UPLOAD_SECONDS = 30;

/** Over this address's share: the refusal, with when to come back. */
async function limited(req: NextRequest) {
  // No trusted address (no proxy in front, or an install that names none): one share for all.
  const ip = clientIp(req) ?? "unknown";
  // Through the front, the address is one of CloudFront's, shared by many callers: a wider share.
  const shared = req.headers.get(FRONT_HEADER) === "ir";
  const v = await rateLimit(`network-bytes:ip:${ip}`, shared || ip === "unknown" ? PER_IP.limit * 10 : PER_IP.limit, PER_IP.windowSec);
  if (v.allowed) return null;
  const r = refuse(`too many road tests from this address — try again in ${v.retryAfter} s`, 429);
  r.headers.set("retry-after", String(v.retryAfter));
  return r;
}

export async function GET(req: NextRequest) {
  const over = await limited(req);
  if (over) return over;
  const raw = req.nextUrl.searchParams.get("size");
  const size = raw === null ? MAX_BYTES : /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) return refuse(`size is a whole number of bytes from 1 to ${MAX_BYTES}`, 400);
  return new NextResponse(new Uint8Array(crypto.randomBytes(size)), {
    headers: { ...NO_CACHE, "content-type": "application/octet-stream", "content-length": String(size) },
  });
}

export async function POST(req: NextRequest) {
  const over = await limited(req);
  if (over) return over;
  const tooBig = `at most ${MAX_BYTES} bytes`;
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BYTES) return refuse(tooBig, 413);
  let received = 0;
  if (req.body) {
    const reader = req.body.getReader();
    const deadline = Date.now() + UPLOAD_SECONDS * 1000;
    try {
      for (;;) {
        const left = deadline - Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("late")), Math.max(0, left))));
        const { done, value } = await Promise.race([reader.read(), late]).finally(() => clearTimeout(timer));
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return refuse(tooBig, 413);
        }
      }
    } catch {
      await reader.cancel().catch(() => {});
      return refuse(`the upload broke off, or took over ${UPLOAD_SECONDS} s`, 400);
    }
  }
  return NextResponse.json({ received }, { headers: NO_CACHE });
}
