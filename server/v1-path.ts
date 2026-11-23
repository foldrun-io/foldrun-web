// The platform API under /v1 (owner, 23 Nov 2026: "like Stripe modern,
// having a v number"; plan: foldrun-admin/docs/api-v1-path-plan-2026-11-23.md).
//
// One address for programs, `https://api.foldrun.io/v1/…`: the model routes
// (the gateway's) and the platform's routes side by side, as Anthropic's and
// Stripe's are. The path carries the generation, v1; the dated
// `Foldrun-Version` header still carries every change inside it.
//
// Who maps it: the API host's nginx (foldrun-infra public-ingress.yaml,
// `server_name ~^api\.`). It sends `/v1/<route>` to this app as
// `/api/<route>`, from the raw request URI, so the app only ever sees /api:
// the scope check, idempotency records, version downgrades and MCP's
// resource all key on the /api path (Codex review, 23 Nov 2026 — Next hands
// a route handler the incoming URL, not a proxy rewrite's). This file is the
// contract nginx is held to (dev/ci/api-host-routes.sh) and the tests' map;
// the app itself refuses a /v1 path that reaches it unmapped.
//
// `/api` stays: it is the dashboard's door, and the browser-only routes
// (server/api-host.ts DASHBOARD_ONLY) are never under /v1.

import { dashboardOnly } from "@/server/api-host";

/** The gateway's routes on the API host. nginx sends these (exact paths) to
 *  the gateway before anything else; they are never the platform's. */
export const V1_MODEL_ROUTES: readonly string[] = [
  "/v1/messages",
  "/v1/messages/count_tokens",
  "/v1/models",
  "/v1/usage",
  "/v1/foldrun/transcribe",
];

/** Platform routes whose /v1 name differs from their /api one. The
 *  platform's account usage is `/api/usage`, but `/v1/usage` is the
 *  gateway's (one key's spend, which Claude Code's status line reads), so the
 *  platform's lives at `/v1/account/usage`. */
export const V1_RENAMES: ReadonlyArray<readonly [v1: string, api: string]> = [["/v1/account/usage", "/api/usage"]];

/** Names under /v1 that belong to the gateway as a whole (anything below
 *  them too): never mapped to the platform. */
export const V1_GATEWAY_PREFIXES: readonly string[] = ["/v1/messages", "/v1/models", "/v1/usage", "/v1/foldrun"];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** What a /v1 path that reached the app unmapped is told. */
export const V1_DIRECT_REFUSAL = "the platform's /v1 is served at the API's address (urls.api in /api/version); here, call /api";

export type V1Target = { api: string } | { refuse: string };

/** Where a `/v1/…` path goes on the platform: the `/api` path that answers
 *  it, or why it is not the platform's. null for a path not under /v1. */
export function v1Target(path: string, method?: string): V1Target | null {
  if (!under(path, "/v1")) return null;
  if (path === "/v1" || path === "/v1/") return { refuse: "not an API route: name one under /v1 — https://docs.foldrun.io/api" };
  for (const [v1, api] of V1_RENAMES) {
    if (under(path, v1)) return { api: api + path.slice(v1.length) };
  }
  if (V1_GATEWAY_PREFIXES.some((p) => under(path, p))) {
    return { refuse: path.startsWith("/v1/usage/") ? "the account's usage is under /v1/account/usage; /v1/usage is one key's own spend" : "a model route: the API host's gateway answers it" };
  }
  const api = `/api${path.slice("/v1".length)}`;
  // The browser's routes stay at /api on the dashboard: a session, a mailed
  // link or a provider's return, never a program's call.
  if (dashboardOnly(api, method)) return { refuse: "not served under /v1: this route is the dashboard's, at /api on the dashboard's address" };
  return { api };
}

/** The `/v1` name of an `/api` path a program may call (OpenAPI, docs), or
 *  null when it has none (dashboard-only). */
export function v1PathOf(apiPath: string, method?: string): string | null {
  if (!under(apiPath, "/api") || apiPath === "/api" || dashboardOnly(apiPath, method)) return null;
  for (const [v1, api] of V1_RENAMES) {
    if (under(apiPath, api)) return v1 + apiPath.slice(api.length);
  }
  return `/v1${apiPath.slice("/api".length)}`;
}
