// Dated API versions, the way Stripe does them.
//
// A caller says which contract it was written against with
// `Foldrun-Version: YYYY-MM-DD`. Without the header it gets its account's
// pin (Settings → API keys → API), and without a pin, the current version. Every API
// response says which one it was answered under, in `Foldrun-Version`.
//
// The current version is API_VERSION in server/release.ts — one constant, the
// same one /v1/version and X-Foldrun-Api report. It moves only when a route
// changes in a way an existing caller would break on; a new route or a new
// field does not move it.
//
// When it does move, the change goes in VERSION_CHANGES below with a
// `downgrade` that turns today's response back into the shape the older
// version promised. A caller pinned before the change gets the downgraded
// body; everybody else gets today's. The route that changed answers through
// versionedJson() so the downgrade has somewhere to run — a test checks
// every route a change names does.
//
// Deprecation policy (docs: foldrun-docs/api-versioning.md): a version is
// supported for at least VERSION_SUPPORT_MONTHS after the one that replaced
// it. A route on its way out carries `Deprecation` (RFC 9745) and, once the
// date is set, `Sunset` (RFC 8594), from DEPRECATIONS below.

import { NextResponse } from "next/server";
import { API_VERSION } from "./release.ts";

export const CURRENT_API_VERSION = API_VERSION;

/** The first dated version, which callers (every CLI up to now) pin. It
 *  stays answerable for its support window whatever changes follow. */
export const FIRST_API_VERSION = "2026-10-01";

/** The request header the proxy writes with the version it resolved, so a
 *  handler (versionedJson) need not resolve it again. Overwritten on every
 *  request — a caller cannot set it. */
export const RESOLVED_VERSION_HEADER = "x-foldrun-resolved-version";

/** From this version an /v1 refusal is Anthropic's error body,
 *  `{ type: "error", error: { type, message } }`, as /v1 answers
 *  (server/error-shape.ts). */
export const ERROR_SHAPE_VERSION = "2026-11-22";

/** The request header the proxy writes with the error body a refusal is
 *  answered in. Overwritten on every request — a caller cannot set it. */
export const ERROR_SHAPE_HEADER = "x-foldrun-error-shape";

export type ErrorShape = "anthropic" | "legacy";

/** The error body for a resolved version and caller: Anthropic's from
 *  ERROR_SHAPE_VERSION on — except for a browser (the dashboard and the
 *  sign-in pages still read the old body; they move with their own change). */
export function errorShapeFor(version: string, browser: boolean): ErrorShape {
  return version >= ERROR_SHAPE_VERSION && !browser ? "anthropic" : "legacy";
}

/** How long a superseded version keeps working, at least. */
export const VERSION_SUPPORT_MONTHS = 12;

export interface VersionChange {
  /** The version that introduced the change: callers pinned BEFORE it get
   *  the downgrade. */
  version: string;
  /** One line for the changelog and the docs page. */
  summary: string;
  /** Which responses it touches. `path` is matched against the URL path. */
  routes: { method: string; path: RegExp; file: string }[];
  /** Today's body → the body the older version promised. */
  downgrade(body: unknown, ctx: { method: string; path: string; status: number }): unknown;
}

/**
 * Every breaking change, newest first. Adding one means a new
 * CURRENT_API_VERSION too.
 */
export const VERSION_CHANGES: VersionChange[] = [
  {
    // One URL format (owner, 23 Nov 2026): every route is /v1/<route>, so
    // GET /v1/version has no path plan to give and drops `paths`. A caller
    // pinned earlier gets it back, saying what is now true — the platform
    // and the models under /v1, the account's usage at /v1/account/usage.
    version: "2026-11-23",
    summary: "GET /v1/version: `paths` is withdrawn — every route is `/v1/<route>`; callers pinned earlier get `paths` saying so (`platform: \"/v1\"`, `models: \"/v1\"`, the usage rename)",
    routes: [{ method: "GET", path: /^\/v1\/version$/, file: "app/v1/version/route.ts" }],
    downgrade(body) {
      if (!body || typeof body !== "object" || "paths" in body) return body;
      return { ...body, paths: { platform: "/v1", models: "/v1", renames: { "/api/usage": "/v1/account/usage" } } };
    },
  },
  {
    // One API, Anthropic's shape (owner, 22 Nov 2026): every /v1 refusal
    // is the body /v1 answers with. Applied where every refusal is built
    // (api.ts errorResponse, by ERROR_SHAPE_HEADER), not route by route, so
    // it names no route here; the downgrade is the same conversion.
    version: ERROR_SHAPE_VERSION,
    summary: "every /v1 refusal is Anthropic's error body — `{ type: \"error\", error: { type, message } }`, a `code` and figures inside `error` — as /v1 answers; callers pinned earlier, and a signed-in browser, keep `{ error: \"…\" }`",
    routes: [],
    downgrade(body) {
      const b = body as { type?: unknown; error?: unknown } | null;
      if (!b || b.type !== "error" || !b.error || typeof b.error !== "object") return body;
      const { type: _type, message, ...rest } = b.error as Record<string, unknown>;
      return { error: message, ...rest };
    },
  },
  {
    // The usage ledger carried the operator's own accounting of the
    // account's lines — what they cost at list price beside what was
    // charged, and the difference as "margin". That view is foldrun's, not
    // the account's (it lives in foldrun-admin), so it is withdrawn for
    // every version. Older pins keep the two keys, as null: a deliberate
    // redaction, not the old values. Nothing foldrun ships read them.
    version: "2026-10-26",
    summary: "GET /v1/account/usage: `ledger.providerCostUsd` and `ledger.marginUsd` are withdrawn; callers pinned earlier get both as null (a redaction, not the old values)",
    routes: [{ method: "GET", path: /^\/v1\/account\/usage$/, file: "app/v1/account/usage/route.ts" }],
    downgrade(body) {
      const b = body as { ledger?: Record<string, unknown> } | null;
      if (!b || typeof b !== "object" || !b.ledger || typeof b.ledger !== "object") return body;
      return { ...b, ledger: { ...b.ledger, providerCostUsd: null, marginUsd: null } };
    },
  },
];

/** Versions a caller may ask for: the current one and every one a change
 *  was released under, plus the first. Anything else is a 400 — a typo'd
 *  date silently answered as "current" is the bug pinning exists to stop. */
export function releasedVersions(changes: VersionChange[] = VERSION_CHANGES): string[] {
  return [...new Set([FIRST_API_VERSION, CURRENT_API_VERSION, ...changes.map((c) => c.version)])].sort();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a Foldrun-Version was refused, as the 400's `code`: a caller (the
 *  CLI) tells "this server is older or newer than me" from a typo without
 *  reading the English. `known` rides beside it. */
export type VersionRefusal = { error: string; code: "bad_api_version" | "unknown_api_version"; known: string[] };

/** A header value, checked. Null header: no opinion. */
export function parseVersion(value: string | null | undefined, known: string[] = releasedVersions()): { version: string | null } | VersionRefusal {
  const v = value?.trim();
  if (!v) return { version: null };
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    return { error: `Foldrun-Version must be a date, YYYY-MM-DD — got ${JSON.stringify(v.slice(0, 40))}`, code: "bad_api_version", known };
  }
  if (!known.includes(v)) {
    return { error: `unknown API version ${v} — this server knows ${known.join(", ")}`, code: "unknown_api_version", known };
  }
  return { version: v };
}

/** Which version answers: the header, else the account's pin, else current.
 *  A pin that is no longer known (a version retired after its support
 *  window) falls forward to current rather than failing every request. */
export function resolveVersion(header: string | null, pin: string | null | undefined, known = releasedVersions()): { version: string } | VersionRefusal {
  const asked = parseVersion(header, known);
  if ("error" in asked) return asked;
  if (asked.version) return { version: asked.version };
  if (pin && known.includes(pin)) return { version: pin };
  return { version: CURRENT_API_VERSION };
}

/** Today's body, downgraded for a caller pinned to `pinned`: every change
 *  released after the pin that touches this route, newest first. */
export function downgradeBody(
  body: unknown,
  pinned: string,
  ctx: { method: string; path: string; status: number },
  changes: VersionChange[] = VERSION_CHANGES,
): unknown {
  let out = body;
  const applicable = changes
    .filter((c) => c.version > pinned && c.routes.some((r) => r.method === ctx.method && r.path.test(ctx.path)))
    .sort((a, b) => (a.version < b.version ? 1 : -1));
  for (const c of applicable) out = c.downgrade(out, ctx);
  return out;
}

/**
 * A JSON answer that respects the caller's pin. For the routes a
 * VersionChange names; every other route can keep NextResponse.json.
 */
export function versionedJson(
  req: Request,
  body: unknown,
  init: ResponseInit = {},
  changes: VersionChange[] = VERSION_CHANGES,
): NextResponse {
  const pinned = req.headers.get(RESOLVED_VERSION_HEADER) ?? CURRENT_API_VERSION;
  const url = new URL(req.url);
  const out = downgradeBody(body, pinned, { method: req.method.toUpperCase(), path: url.pathname, status: init.status ?? 200 }, changes);
  return NextResponse.json(out, init);
}

// ------------------------------------------------------------- deprecation

export interface Deprecation {
  method: string;
  path: RegExp;
  /** The route as people read it, for What's new: `DELETE /v1/workspaces/<ws>/thing`. */
  route: string;
  /** When it was deprecated (ISO date). */
  deprecatedAt: string;
  /** When it stops answering (ISO date), once decided. */
  sunsetAt?: string;
  /** Where the replacement is described. */
  link?: string;
}

/** Routes on their way out. */
export const DEPRECATIONS: Deprecation[] = [
  // The platform's own git (17 Oct 2026): the per-workspace remote, its
  // branches and mirror, and the GitHub push webhook go, and history moved
  // to the platform's snapshots (POST /restore rolls back). GitHub and GitLab
  // come back later as a connected app. Sunset the same day, on purpose:
  // every account on the install is the operator's own, and the /git/
  // remote was never reachable from outside. The owner's call, against the
  // six-month default — a deprecation with customers on it gets the six.
  { method: "GET", path: /^\/v1\/workspaces\/[^/]+\/repo$/, route: "GET /v1/workspaces/<ws>/repo", deprecatedAt: "2026-10-17", sunsetAt: "2026-10-17", link: "https://docs.foldrun.io/backups-and-restore" },
  { method: "POST", path: /^\/v1\/workspaces\/[^/]+\/repo$/, route: "POST /v1/workspaces/<ws>/repo", deprecatedAt: "2026-10-17", sunsetAt: "2026-10-17", link: "https://docs.foldrun.io/backups-and-restore" },
  { method: "POST", path: /^\/v1\/git\/[^/]+\/[^/]+$/, route: "POST /v1/git/<account>/<ws>", deprecatedAt: "2026-10-17", sunsetAt: "2026-10-17", link: "https://docs.foldrun.io/deploying" },
  // One mechanism per flow edit (FOL-75, 5 Nov 2026): adding and removing a
  // step are PATCH { edit: { op: "insert" | "remove" } } — what the canvas,
  // the list view's board and the CLI all send. The older POST (a step at
  // the end) and DELETE ({ step }) made the same edits; sunset the same day
  // (owner, 5 Nov 2026: "deprecate now" — no paying customers, and no client
  // of ours calls them). Not /flows/draft, whose POST drafts.
  { method: "POST", path: /^\/v1\/workspaces\/[^/]+\/flows\/(?!draft$)[^/]+$/, route: "POST /v1/workspaces/<ws>/flows/<flow>", deprecatedAt: "2026-11-05", sunsetAt: "2026-11-05", link: "https://docs.foldrun.io/api" },
  { method: "DELETE", path: /^\/v1\/workspaces\/[^/]+\/flows\/(?!draft$)[^/]+$/, route: "DELETE /v1/workspaces/<ws>/flows/<flow>", deprecatedAt: "2026-11-05", sunsetAt: "2026-11-05", link: "https://docs.foldrun.io/api" },
];

/**
 * Where the OpenAPI document was wrong and the API never behaved the way it
 * said, so correcting the document is not a break. scripts/api-guard.mjs
 * reports these instead of refusing them. `path` is the OpenAPI path,
 * `/v1/workspaces/{workspace}/runs`. Never for a real change in what the
 * API does: that is a VersionChange.
 */
export const SCHEMA_CORRECTIONS: { method: string; path: string; reason: string }[] = [
  {
    method: "POST",
    path: "/v1/workspaces/{workspace}/deploy",
    reason: "files was documented as a path → content object; the route has only ever taken an array of { path, content } and refuses an object with 400 (corrected 30 Oct 2026)",
  },
  {
    method: "GET",
    path: "/v1/billing",
    reason: "balance was documented but never answered — the field has always been balanceUsd (corrected 30 Oct 2026)",
  },
];

/** `Deprecation: @<epoch>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) and
 *  a `Link rel="deprecation"` when there is somewhere to read about it. */
export function deprecationHeaders(d: Pick<Deprecation, "deprecatedAt" | "sunsetAt" | "link">): Record<string, string> {
  const out: Record<string, string> = {
    deprecation: `@${Math.floor(Date.parse(d.deprecatedAt) / 1000)}`,
  };
  if (d.sunsetAt) out.sunset = new Date(d.sunsetAt).toUTCString();
  if (d.link) out.link = `<${d.link}>; rel="deprecation"; type="text/html"`;
  return out;
}

/** The deprecation that covers this request, if any. */
export function deprecationFor(method: string, pathname: string, list: Deprecation[] = DEPRECATIONS): Deprecation | null {
  return list.find((d) => d.method === method.toUpperCase() && d.path.test(pathname)) ?? null;
}

// ------------------------------------------------------------- what's new

export interface ApiChangelog {
  /** The version a caller with no header and no pin gets. */
  current: string;
  /** How long a superseded version keeps working, at least. */
  supportMonths: number;
  /** Every version a caller may pin, newest first, with the breaking
   *  changes it introduced (none for the first). */
  versions: { version: string; changes: string[] }[];
  /** Routes on their way out. */
  deprecations: { route: string; deprecatedAt: string; sunsetAt: string | null; link: string | null }[];
}

/** The API's own changelog, for What's new, /v1/changelog and the CLI: the
 *  versions, what each one broke, and what is deprecated. */
export function apiChangelog(changes: VersionChange[] = VERSION_CHANGES, deprecations: Deprecation[] = DEPRECATIONS): ApiChangelog {
  return {
    current: CURRENT_API_VERSION,
    supportMonths: VERSION_SUPPORT_MONTHS,
    versions: releasedVersions(changes)
      .reverse()
      .map((version) => ({ version, changes: changes.filter((c) => c.version === version).map((c) => c.summary) })),
    deprecations: deprecations.map((d) => ({ route: d.route, deprecatedAt: d.deprecatedAt, sunsetAt: d.sunsetAt ?? null, link: d.link ?? null })),
  };
}
