// Rate limits for the authenticated API, and the per-request gate the proxy
// runs in front of every /api route.
//
// Two buckets per request, both must have room:
//   · the CREDENTIAL — one API key, or one signed-in person — so one runaway
//     script cannot spend the whole account's allowance;
//   · the ACCOUNT — every key and person together — so twenty keys are not
//     twenty allowances.
// Reads (GET, HEAD, OPTIONS) and writes count separately: a dashboard polling
// runs must not use up the budget a deploy needs, and writes cost more.
//
// The counters are server/limits.ts's — the platform cache: Redis when the
// install has it, so every web pod counts against the same number, and an
// in-process counter otherwise (one pod, the common laptop case). Fixed
// one-minute windows.
//
// Every answer carries X-RateLimit-Limit / -Remaining / -Reset for whichever
// bucket is closer to empty (Reset is a Unix time, in seconds, as GitHub
// sends it). Over the limit: 429, Retry-After, and { error, retry_after }.
//
// Requests with no credential are not counted here: they are refused by the
// route (401), or are the open routes that carry their own proof and their
// own flood control (webhooks, sign-in).

import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/platform/cache";
import { recordApiCall } from "@/platform/api-usage";
import { billing } from "@/platform/billing";
import { adminState } from "@/platform/admin";
import { apiKeyFor } from "./auth.ts";
import { verifySession, SESSION_COOKIE } from "./users.ts";
import { supportExempt } from "./view-as.ts";
import { resolveVersion, deprecationFor, deprecationHeaders, RESOLVED_VERSION_HEADER } from "./api-version.ts";

export const WINDOW_SEC = 60;

export interface Tier {
  /** Requests per minute for one key or one person. */
  read: number;
  write: number;
}

/** Per-credential limits by plan. The account's bucket is ACCOUNT_MULTIPLE
 *  times this. An account with no plan (trial, `self-hosted` edition) is `free`. */
export const TIERS: Record<"free" | "starter" | "creator" | "pro" | "scale", Tier> = {
  free: { read: 300, write: 60 },
  starter: { read: 600, write: 120 },
  creator: { read: 1200, write: 240 },
  pro: { read: 3000, write: 600 },
  scale: { read: 6000, write: 1200 },
};
export const ACCOUNT_MULTIPLE = 3;

export type TierName = keyof typeof TIERS;

export function tierOf(planId: string | null | undefined): TierName {
  return planId && planId in TIERS ? (planId as TierName) : "free";
}

/** What Settings → API and GET /api/account/api show. */
export function limitsFor(tier: TierName) {
  const t = TIERS[tier];
  return {
    plan: tier,
    windowSeconds: WINDOW_SEC,
    perCredential: { read: t.read, write: t.write },
    perAccount: { read: t.read * ACCOUNT_MULTIPLE, write: t.write * ACCOUNT_MULTIPLE },
  };
}

export const isRead = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/** FOLDRUN_API_RATE_LIMIT=off switches counting off (a load test, an install
 *  behind its own gateway). Headers for the version still go out. */
const limitingOn = () => (process.env.FOLDRUN_API_RATE_LIMIT ?? "").toLowerCase() !== "off";

// ---------------------------------------------------------- who is calling
//
// The route resolves the caller again, properly, and refuses a revoked key
// there. This lookup only decides which counters to bump, so it is cached
// for a short while per pod: two database reads per request for a counter
// would cost more than the counter protects.

interface Caller {
  tenant: string;
  /** key:<id>, user:<id>, or support:<who> for a support view */
  credential: string;
  /** Who it is, for a person reading API usage: `key "ci" (fr_ab12cd34ef…)`,
   *  `a signed-in person (user <id>)`. Never the secret. */
  who: string;
}

const CALLER_TTL_MS = 30_000;
const callerCache = new Map<string, { caller: Caller | null; until: number }>();

async function callerOf(req: NextRequest): Promise<Caller | null> {
  const authz = req.headers.get("authorization");
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  let cacheKey: string;
  if (authz && /^bearer\s/i.test(authz)) cacheKey = "b:" + sha(authz.replace(/^bearer\s+/i, "").trim());
  else if (cookie) cacheKey = "s:" + sha(cookie);
  else return null;
  const now = Date.now();
  const hit = callerCache.get(cacheKey);
  if (hit && hit.until > now) return hit.caller;
  let caller: Caller | null = null;
  try {
    if (cacheKey.startsWith("b:")) {
      const k = await apiKeyFor(authz!.replace(/^bearer\s+/i, "").trim(), req.headers);
      // A deploy key is refused by the route; it still counts against its
      // account, by its hash, so a CI loop of refusals is throttled too.
      if (k) caller = { tenant: k.tenant, credential: `key:${cacheKey.slice(2, 18)}`, who: `key "${k.label}" (${k.prefix}…)` };
    } else {
      const s = await verifySession(cookie);
      // A support view reads as the owner (s.id is the owner's), but the
      // browsing is the support person's: their own bucket, not the owner's.
      if (s) caller = { tenant: s.tenant, credential: s.viewAs ? `support:${s.viewAs.by}` : `user:${s.id}`, who: s.viewAs ? "a support view" : `a signed-in person (user ${s.id})` };
    }
  } catch {
    caller = null; // the route will say what is wrong; never fail here
  }
  if (callerCache.size > 5_000) for (const [k, v] of callerCache) if (v.until <= now) callerCache.delete(k);
  callerCache.set(cacheKey, { caller, until: now + CALLER_TTL_MS });
  return caller;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ------------------------------------------------- the account's settings

interface Profile {
  tier: TierName;
  pin: string | null;
}
const PROFILE_TTL_MS = 30_000;
const profileCache = new Map<string, { p: Profile; until: number }>();

export async function accountProfile(tenant: string): Promise<Profile> {
  const now = Date.now();
  const hit = profileCache.get(tenant);
  if (hit && hit.until > now) return hit.p;
  let tier: TierName = "free";
  let pin: string | null = null;
  try {
    const plan = await billing().planStanding(tenant);
    tier = plan && plan.status !== "cancelled" ? tierOf(plan.id) : "free";
  } catch {}
  try {
    pin = (await adminState(tenant)).apiVersion ?? null;
  } catch {}
  const p = { tier, pin };
  profileCache.set(tenant, { p, until: now + PROFILE_TTL_MS });
  return p;
}

/** After a pin or plan change in this pod; other pods catch up within PROFILE_TTL_MS. */
export function forgetAccountProfile(tenant: string): void {
  profileCache.delete(tenant);
}

// ------------------------------------------------------------- the gate

/**
 * Routes that are neither counted nor refused. A spent bucket must not stop
 * a person signing out (or support ending a view), nor a monitor reading
 * health, status or the version — none of them costs anything to answer.
 */
export function unmetered(method: string, pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "");
  if (method === "GET" || method === "HEAD") {
    if (p === "/api/healthz" || p === "/api/version" || p === "/api/status" || p.startsWith("/api/status/")) return true;
  }
  if (method === "POST" && p === "/api/auth/logout") return true;
  if (supportExempt(method, p)) return true;
  return false;
}

export interface Gate {
  /** Answer this instead of running the route. */
  refuse?: NextResponse;
  /** Headers for the response. */
  headers: Record<string, string>;
  /** Headers for the forwarded request (the resolved version). */
  requestHeaders: Record<string, string>;
}

/**
 * Everything the proxy asks of an /api request before the route runs: which
 * API version answers it, whether it is over its rate limit, and whether the
 * route is deprecated. Never throws.
 */
export async function apiGate(req: NextRequest): Promise<Gate> {
  const headers: Record<string, string> = {};
  const caller = await callerOf(req);
  const profile = caller ? await accountProfile(caller.tenant) : null;

  // The pin is for code the account wrote against an older API — its keys.
  // The dashboard ships with the server, so a signed-in person always gets
  // the current shapes; a pin must never feed it bodies it predates.
  const pin = caller?.credential.startsWith("key:") ? profile?.pin : null;
  const version = resolveVersion(req.headers.get("foldrun-version"), pin);
  if ("error" in version) {
    return { refuse: NextResponse.json({ error: version.error, code: version.code, known: version.known }, { status: 400 }), headers, requestHeaders: {} };
  }
  headers["foldrun-version"] = version.version;
  const dep = deprecationFor(req.method, req.nextUrl.pathname);
  if (dep) Object.assign(headers, deprecationHeaders(dep));
  // Who meets which version, and who still calls a route on its way out —
  // what Settings → API shows and the sunset warnings are sent from
  // (platform api-usage.ts). Counted in memory; never waits, never throws.
  if (caller) recordApiCall({ tenant: caller.tenant, version: version.version, ...(dep ? { route: dep.route, credential: caller.who } : {}) });

  if (caller && profile && limitingOn() && !unmetered(req.method, req.nextUrl.pathname)) {
    const kind = isRead(req.method) ? "r" : "w";
    const tier = TIERS[profile.tier];
    const perCred = kind === "r" ? tier.read : tier.write;
    const perAccount = perCred * ACCOUNT_MULTIPLE;
    const [mine, theirs] = await Promise.all([
      rateLimit(`api:${caller.tenant}:${caller.credential}:${kind}`, perCred, WINDOW_SEC),
      rateLimit(`api:${caller.tenant}:*:${kind}`, perAccount, WINDOW_SEC),
    ]);
    // Report the bucket closer to running out — the one that will refuse first.
    const tight = !theirs.allowed || (mine.allowed && theirs.remaining < mine.remaining) ? { v: theirs, limit: perAccount } : { v: mine, limit: perCred };
    headers["x-ratelimit-limit"] = String(tight.limit);
    headers["x-ratelimit-remaining"] = String(tight.v.remaining);
    headers["x-ratelimit-reset"] = String(Math.floor(Date.now() / 1000) + tight.v.retryAfter);
    if (!mine.allowed || !theirs.allowed) {
      const retry = Math.max(!mine.allowed ? mine.retryAfter : 0, !theirs.allowed ? theirs.retryAfter : 0);
      const which = !mine.allowed ? (caller.credential.startsWith("key:") ? "this API key" : "you") : "this account";
      headers["retry-after"] = String(retry);
      return {
        refuse: NextResponse.json(
          {
            error: `rate limit: ${which} may make ${tight.limit} ${kind === "r" ? "reads" : "writes"} a minute — retry in ${retry}s`,
            retry_after: retry,
          },
          { status: 429 },
        ),
        headers,
        requestHeaders: {},
      };
    }
  }
  return { headers, requestHeaders: { [RESOLVED_VERSION_HEADER]: version.version } };
}

/** For tests: forget cached callers and accounts. */
export function resetApiGateCaches(): void {
  callerCache.clear();
  profileCache.clear();
}
