// One client, many guesses: the per-client gate on emailed-code sign-in.
//
// The per-code and per-address limits (server/login-codes.ts) say nothing
// about one machine trying many addresses, or asking for new codes as fast as
// they are spent. This counts every FAILED code attempt from one client,
// whatever the code or the address, and after FAILURES of them inside
// WINDOW_SEC refuses that client code sign-in for BLOCK_SEC. A blocked client
// is answered as any failure is (the same words, the same status, the same
// floor in time), so the block says nothing a wrong code did not.
//
// Who is "one client", and who is not:
//   - only an address the edge vouches for (edgeClientIp: our Cloudflare zone
//     stamped the request). A header anyone can send is never read; with no
//     such address there is no gate, and the per-code and per-address limits
//     stand alone. There is no shared "unknown" bucket: that would let one
//     client lock everybody out.
//   - IPv4 by the exact address, IPv6 by its /64 (one subscriber holds a /64,
//     so a new address inside it is not a new client).
//   - never an address that cannot be a client: loopback, private, link-local
//     and the like are the proxy's or the cluster's own, and blocking one
//     would block everyone behind it.
//
// Counters live where the other rate limits do: Redis with an expiry, and the
// process's own memory when Redis is not there or does not answer (the same
// fail-open stance as rateLimit in the platform's cache).

import net from "node:net";
import { cache } from "@/platform/cache";
import { opsLog } from "@/lib/ops-log.ts";
import { edgeClientIp } from "@/server/limits";

/** Failed attempts, within the window, that earn a block. */
export const FAILURES = 4;
export const WINDOW_SEC = 15 * 60;
export const BLOCK_SEC = 5 * 60;

/** The 16-bit groups of an IPv6 address, or null. Handles `::` and a dotted tail. */
function groups(addr: string): number[] | null {
  let a = addr.toLowerCase().split("%")[0];
  const dotted = a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[2].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    a = dotted[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  const out = all.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return out.length === 8 && out.every((n) => Number.isInteger(n)) ? out : null;
}

/** An IPv4 address that is the proxy's, the cluster's or nobody's. */
function privateV4(o: number[]): boolean {
  const [a, b] = o;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The key one client is counted under, or null when it must not be (no
 * address, not an address, or one that cannot be a client). IPv4: the address;
 * IPv6: its /64; an IPv4-mapped IPv6 address: the IPv4 one inside it.
 */
export function gateKey(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").trim();
  const kind = net.isIP(raw);
  if (!kind) return null;
  if (kind === 4) {
    const o = raw.split(".").map(Number);
    return privateV4(o) ? null : o.join(".");
  }
  const g = groups(raw);
  if (!g) return null;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    const o = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
    return privateV4(o) ? null : o.join(".");
  }
  if (g.every((n) => n === 0) || (g[0] === 0 && g.slice(1, 7).every((n) => n === 0) && g[7] === 1)) return null; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return null; // unique local, link-local, multicast
  return "v6:" + g.slice(0, 4).map((n) => n.toString(16)).join(":");
}

/** The key for this request's client, or null: see the top of the file. */
export const codeGateKey = (req: Parameters<typeof edgeClientIp>[0]): string | null => gateKey(edgeClientIp(req));

// The process's own counters, for no Redis or a Redis that does not answer.
const local = new Map<string, { n: number; until: number }>();
const blocks = new Map<string, number>();

function sweep(now: number): void {
  if (local.size + blocks.size < 10_000) return;
  for (const [k, v] of local) if (v.until <= now) local.delete(k);
  for (const [k, v] of blocks) if (v <= now) blocks.delete(k);
}

/** Is this client blocked right now? Never counts anything. */
export async function codeGateBlocked(key: string, now = Date.now()): Promise<boolean> {
  const c = cache();
  if (c) {
    try {
      return (await c.exists(`codegate:block:${key}`)) === 1;
    } catch {
      // fall through to this process's own count
    }
  }
  return (blocks.get(key) ?? 0) > now;
}

/**
 * One failed attempt from this client. Returns true when this one earned the
 * block (and writes the one counts-only line for it: how many, how long —
 * never a code, an address or an email).
 */
export async function codeGateFailed(key: string, now = Date.now()): Promise<boolean> {
  let n = 0;
  let blocked = false;
  const c = cache();
  let used = false;
  if (c) {
    try {
      const k = `codegate:fail:${key}`;
      n = await c.incr(k);
      if (n === 1) await c.expire(k, WINDOW_SEC);
      if (n >= FAILURES) blocked = (await c.set(`codegate:block:${key}`, "1", "EX", BLOCK_SEC, "NX")) === "OK";
      used = true;
    } catch {
      // fall through to this process's own count
    }
  }
  if (!used) {
    sweep(now);
    const hit = local.get(key);
    const cur = hit && hit.until > now ? hit : { n: 0, until: now + WINDOW_SEC * 1000 };
    cur.n += 1;
    local.set(key, cur);
    n = cur.n;
    if (n >= FAILURES && (blocks.get(key) ?? 0) <= now) {
      blocks.set(key, now + BLOCK_SEC * 1000);
      blocked = true;
    }
  }
  if (blocked) opsLog("warn", "auth.code_client_blocked", { surface: "login-code", count: n, secs: BLOCK_SEC });
  return blocked;
}

/** Forget every count (tests). */
export function resetCodeGate(): void {
  local.clear();
  blocks.clear();
}
