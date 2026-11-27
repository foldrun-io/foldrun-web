// The authorization matrix, as data: for every API route and method, who may
// call it, from the documented design — foldrun-docs api.md, the role
// standard (platform permissions.ts: viewer reads, editor works, admin runs
// the account, owner pays), and the guard each handler calls (requireTenant /
// requireCaller = any signed-in role; requirePermission(action); requirePerson
// = a signed-in person, not a hand-made key; requireSession / requireOwner =
// the cookie; requireAccountWide = no workspace limit). authz-matrix.test.ts
// turns each row into one expected status per kind of caller, and fails when a
// route in app/v1 has no row, so a new route cannot slip in unclassified.
//
// A row is  [METHOD, path, spec, extras?]. The spec is words:
//   viewer | editor | admin | owner   the least role (default viewer = any signed-in caller)
//   none      no credential needed (a public or sign-in route)
//   token     a link token in the URL is the credential; without a valid one, refused
//   hosted    exists only on the hosted edition: 404 to everyone on a self-hosted one (the rest of the spec applies on the hosted one)
//   gone      answers 410 to everyone
//   wide      shared by every workspace: a caller limited to some workspaces is refused
//   person    a signed-in person; a key made by hand is refused (after the role check)
//   session   the session cookie alone; any key is refused
//   ownerOnly the session of the account owner; any key is refused
//   keyOnly   an API key alone (a session is refused)
// A workspace route (/v1/workspaces/{workspace}/…) is refused to a caller
// limited to other workspaces without being said.
// extras: q (query string), body, params (override), ok (statuses a caller
// that is let in may get), anon (what no credential gets, when not 401).

import { A, IDS, SHARE } from "./authz-matrix-fixture.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface Extras {
  q?: string;
  body?: unknown;
  params?: Record<string, string>;
  ok?: number[];
  anon?: number;
}
export type Row = [Method, string, string, Extras?];

/** What a write that is let in may answer when the body is empty or invalid (the matrix never sends a valid destructive one). */
export const WRITE_OK = [200, 201, 202, 204, 400, 404, 409, 411, 413, 415, 422, 423, 502];

export const TABLE: Row[] = [
  // ---- the account --------------------------------------------------------
  ["GET", "/v1/account", "viewer"],
  ["PATCH", "/v1/account", "admin wide"],
  ["GET", "/v1/account/agents-md", "viewer wide"],
  ["PUT", "/v1/account/agents-md", "admin wide"],
  ["GET", "/v1/account/api", "viewer"],
  ["PATCH", "/v1/account/api", "admin wide"],
  ["GET", "/v1/account/backups", "viewer"],
  ["GET", "/v1/account/backups/requests", "viewer"],
  ["POST", "/v1/account/backups/requests", "admin"],
  ["POST", "/v1/account/close", "hosted owner ownerOnly"],
  ["GET", "/v1/account/export", "owner"],
  ["GET", "/v1/account/flags", "viewer"],
  ["GET", "/v1/account/jobs", "viewer"],
  ["GET", "/v1/account/beta", "viewer"],
  ["PUT", "/v1/account/beta", "admin wide"],
  ["GET", "/v1/account/model", "viewer"],
  ["PUT", "/v1/account/model", "admin wide"],
  ["DELETE", "/v1/account/model", "admin wide"],
  ["GET", "/v1/account/pause", "viewer"],
  ["POST", "/v1/account/pause", "admin wide"],
  ["DELETE", "/v1/account/pause", "admin wide"],
  ["GET", "/v1/account/providers", "viewer"],
  ["POST", "/v1/account/providers", "editor wide"],
  ["POST", "/v1/account/telemetry/test", "admin wide"],
  ["GET", "/v1/approvals", "viewer"],
  ["GET", "/v1/assistant/conversations", "viewer"],
  ["GET", "/v1/assistant/conversations/{id}", "viewer", { ok: [404] }],
  ["DELETE", "/v1/assistant/conversations/{id}", "viewer", { ok: [404] }],
  ["GET", "/v1/audit", "admin wide"],
  ["GET", "/v1/changelog", "viewer"],
  ["GET", "/v1/customers", "viewer"],
  ["PATCH", "/v1/customers", "admin wide"],
  ["PUT", "/v1/customers/{customer}/block", "admin wide"],
  ["DELETE", "/v1/customers/{customer}/block", "admin wide"],
  ["GET", "/v1/customers/usage", "viewer"],
  ["GET", "/v1/identity", "viewer"],
  ["GET", "/v1/insights", "viewer"],
  ["GET", "/v1/issues", "viewer"],
  ["GET", "/v1/issues/{id}", "viewer", { ok: [404] }],
  ["POST", "/v1/issues/{id}", "editor"],
  ["GET", "/v1/observe", "viewer"],
  ["GET", "/v1/schedule", "viewer"],
  ["POST", "/v1/schedule", "admin wide"],
  ["GET", "/v1/search", "viewer", { q: "q=canary" }],
  ["GET", "/v1/account/usage", "viewer"],
  ["GET", "/v1/account/usage/budget", "viewer"],
  ["GET", "/v1/account/usage/compute", "viewer"],
  ["GET", "/v1/account/usage/history", "viewer"],
  ["GET", "/v1/account/usage/rates", "viewer"],
  ["GET", "/v1/me", "viewer"],
  ["GET", "/v1/me/inbox", "viewer"],
  ["POST", "/v1/me/inbox", "viewer"],
  ["GET", "/v1/me/notifications", "viewer"],
  ["PATCH", "/v1/me/notifications", "viewer"],
  ["GET", "/v1/me/onboarding", "viewer"],
  ["PATCH", "/v1/me/onboarding", "session"],
  ["GET", "/v1/me/preferences", "viewer"],
  ["PATCH", "/v1/me/preferences", "viewer"],
  ["POST", "/v1/extract", "editor", { ok: [200, 202, 400, 404, 411, 413, 415, 422, 501, 503] }],
  ["GET", "/v1/extract/{id}", "viewer", { ok: [404] }],
  ["GET", "/v1/library/{kind}", "viewer wide", { params: { kind: "knowledge" } }],
  ["POST", "/v1/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["PUT", "/v1/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["DELETE", "/v1/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["GET", "/v1/library/gallery", "viewer"],
  ["POST", "/v1/library/gallery", "editor wide"],
  ["GET", "/v1/avatars/{kind}/{id}", "viewer", { params: { kind: "account", id: A.tenant }, ok: [200, 404] }],
  ["PUT", "/v1/avatars/{kind}/{id}", "admin wide", { params: { kind: "account", id: A.tenant } }],
  ["DELETE", "/v1/avatars/{kind}/{id}", "admin wide", { params: { kind: "account", id: A.tenant } }],

  // ---- keys, team, sign-in ---------------------------------------------------
  ["GET", "/v1/keys", "admin"],
  ["POST", "/v1/keys", "admin"],
  ["DELETE", "/v1/keys", "admin", { body: { id: "no-such-key" } }],
  ["PATCH", "/v1/keys/{id}", "admin wide", { params: { id: "no-such-key" } }],
  ["DELETE", "/v1/keys/{id}", "admin", { params: { id: "no-such-key" } }],
  ["POST", "/v1/keys/{id}/rotate", "admin", { params: { id: "no-such-key" } }],
  ["GET", "/v1/team", "viewer"],
  ["POST", "/v1/team", "admin person"],
  ["GET", "/v1/team/invites", "admin"],
  ["DELETE", "/v1/team/invites/{id}", "admin", { ok: [404] }],
  ["PATCH", "/v1/team/members/{id}", "admin person", { ok: [404, 400] }],
  ["DELETE", "/v1/team/members/{id}", "admin person", { ok: [404, 400] }],
  ["POST", "/v1/team/transfer", "owner person"],
  ["POST", "/v1/auth/email", "session"],
  ["POST", "/v1/auth/forgot", "none", { ok: [200, 400, 429] }],
  ["POST", "/v1/auth/login", "none", { ok: [400, 401, 429] }],
  ["POST", "/v1/auth/login/code", "none", { ok: [200, 400, 404, 429] }],
  ["POST", "/v1/auth/login/code/verify", "none", { ok: [400, 401, 404, 429] }],
  ["POST", "/v1/auth/logout", "none"],
  ["POST", "/v1/auth/mfa/disable", "session", { ok: [400, 401, 403] }],
  ["POST", "/v1/auth/mfa/enable", "session"],
  ["POST", "/v1/auth/mfa/setup", "session"],
  ["POST", "/v1/auth/mfa/verify", "none", { ok: [400, 401, 429] }],
  ["POST", "/v1/auth/name", "session"],
  ["POST", "/v1/auth/password", "session"],
  ["POST", "/v1/auth/reset", "none", { ok: [400, 401, 429] }],
  ["GET", "/v1/auth/session", "none"],
  ["GET", "/v1/auth/sessions", "session"],
  ["DELETE", "/v1/auth/sessions", "session"],
  ["POST", "/v1/auth/signup", "none", { ok: [400, 403, 429] }],
  ["POST", "/v1/auth/timezone", "session"],
  ["GET", "/v1/auth/verify", "none", { ok: [303] }],
  // A bad or missing token goes to /login?verify=invalid: a 303 for every caller (FOL-319).
  ["POST", "/v1/auth/verify", "none", { ok: [303] }],
  ["POST", "/v1/auth/verify/resend", "session"],
  ["GET", "/v1/cli/authorize", "none", { ok: [404, 400, 307] }],
  ["POST", "/v1/cli/authorize", "session"],
  ["POST", "/v1/cli/login", "none"],
  ["GET", "/v1/cli/login/{id}", "none", { ok: [200, 404] }],
  ["POST", "/v1/mcp", "keyOnly", { ok: [200, 202, 400, 404, 405] }],
  ["POST", "/v1/mcp/clients", "admin"],
  ["GET", "/v1/mcp/connections", "viewer"],
  ["DELETE", "/v1/mcp/connections/{id}", "viewer", { ok: [404] }],
  ["GET", "/v1/mcp/oauth/authorize", "session", { ok: [400, 302, 307] }],
  ["POST", "/v1/mcp/oauth/authorize", "session"],
  ["POST", "/v1/mcp/oauth/register", "none"],
  ["POST", "/v1/mcp/oauth/revoke", "none", { ok: [200, 400, 401] }],
  ["POST", "/v1/mcp/oauth/token", "none", { ok: [400, 401] }],
  ["GET", "/v1/oauth/callback", "none", { ok: [302, 307, 400] }],
  ["GET", "/v1/oauth/clients", "viewer"],
  ["POST", "/v1/oauth/clients", "admin wide"],
  ["DELETE", "/v1/oauth/clients", "admin wide"],
  ["GET", "/v1/oauth/connections", "viewer"],
  ["POST", "/v1/oauth/device", "admin"],
  ["POST", "/v1/oauth/device/{id}", "admin"],
  ["POST", "/v1/oauth/discover", "admin"],
  ["POST", "/v1/oauth/handoff/{id}", "admin person", { ok: [404, 400] }],
  ["POST", "/v1/oauth/reconnect", "admin"],
  ["POST", "/v1/oauth/start", "admin"],
  ["GET", "/v1/secrets", "viewer wide"],
  ["PUT", "/v1/secrets", "admin"],
  ["PATCH", "/v1/secrets", "admin"],
  ["DELETE", "/v1/secrets", "admin"],
  ["POST", "/v1/unsubscribe", "none", { ok: [400, 403, 404] }],

  // ---- links whose token is the credential ----------------------------------
  ["GET", "/v1/approve/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/v1/approve/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/v1/events/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/v1/hooks/{tenant}/{workspace}/{flow}", "token", { q: "token=forged" }],
  ["POST", "/v1/inbox/{tenant}/{workspace}/{flow}", "token", { q: "token=forged" }],

  // ---- public ---------------------------------------------------------------
  ["GET", "/v1/healthz", "none"],
  ["GET", "/v1/metrics", "token", { ok: [404] }],
  ["GET", "/v1/network/bytes", "none"],
  ["POST", "/v1/network/bytes", "none"],
  ["GET", "/v1/openapi.json", "none"],
  ["GET", "/v1/pricing", "none", { ok: [200, 404] }],
  ["GET", "/v1/signup", "none"],
  ["GET", "/v1/status", "none"],
  ["GET", "/v1/status/history", "none"],
  ["GET", "/v1/version", "none"],

  // ---- workspaces -------------------------------------------------------------
  ["GET", "/v1/workspaces", "viewer"],
  ["POST", "/v1/workspaces", "admin"],
  ["GET", "/v1/workspaces/{workspace}", "viewer"],
  ["PATCH", "/v1/workspaces/{workspace}", "admin"],
  ["DELETE", "/v1/workspaces/{workspace}", "admin"],
  ["GET", "/v1/workspaces/{workspace}/a2a", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/agents", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/agents", "editor"],
  ["PATCH", "/v1/workspaces/{workspace}/agents/{agent}", "editor"],
  ["POST", "/v1/workspaces/{workspace}/agents/{agent}/run", "editor"],
  ["GET", "/v1/workspaces/{workspace}/agents/import", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/agents/import", "editor"],
  ["POST", "/v1/workspaces/{workspace}/assets", "editor"],
  ["POST", "/v1/workspaces/{workspace}/assistant", "editor"],
  ["GET", "/v1/workspaces/{workspace}/check", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/deploy", "editor"],
  ["GET", "/v1/workspaces/{workspace}/evals", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/evals", "editor"],
  ["GET", "/v1/workspaces/{workspace}/evals/{evalName}/compare", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/evals/{evalName}/compare", "editor"],
  ["POST", "/v1/workspaces/{workspace}/evals/{evalName}/grade", "editor"],
  ["GET", "/v1/workspaces/{workspace}/evals/{evalName}/grades", "viewer", { ok: [200, 400] }],
  ["POST", "/v1/workspaces/{workspace}/evals/{evalName}/improve", "editor"],
  ["GET", "/v1/workspaces/{workspace}/evals/{evalName}/run", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/evals/{evalName}/run", "editor"],
  ["GET", "/v1/workspaces/{workspace}/evals/trends", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/export", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/flows", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/flows", "editor"],
  ["PATCH", "/v1/workspaces/{workspace}/flows/{flow}", "editor"],
  ["POST", "/v1/workspaces/{workspace}/flows/{flow}/filter", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/flows/{flow}/run", "editor"],
  ["POST", "/v1/workspaces/{workspace}/flows/draft", "editor"],
  ["PATCH", "/v1/workspaces/{workspace}/flows/draft", "editor"],
  ["DELETE", "/v1/workspaces/{workspace}/flows/draft", "gone"],
  ["GET", "/v1/workspaces/{workspace}/history", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/hooks", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/hooks/{flow}", "admin"],
  ["POST", "/v1/workspaces/{workspace}/hooks/{flow}/rotate", "admin"],
  ["POST", "/v1/workspaces/{workspace}/hooks/{flow}/test", "editor"],
  ["POST", "/v1/workspaces/{workspace}/import", "editor"],
  ["GET", "/v1/workspaces/{workspace}/notify/deliveries", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/notify/deliveries/{id}/redeliver", "editor", { ok: [404] }],
  ["POST", "/v1/workspaces/{workspace}/notify/test", "editor"],
  ["GET", "/v1/workspaces/{workspace}/observe", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/pause", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/pause", "admin"],
  ["DELETE", "/v1/workspaces/{workspace}/pause", "admin"],
  ["GET", "/v1/workspaces/{workspace}/proposals", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/proposals/{id}", "viewer", { ok: [400, 404] }],
  ["POST", "/v1/workspaces/{workspace}/proposals/{id}", "editor"],
  ["POST", "/v1/workspaces/{workspace}/restore", "editor"],
  ["GET", "/v1/workspaces/{workspace}/runs", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/runs/bulk", "editor"],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}", "viewer"],
  ["DELETE", "/v1/workspaces/{workspace}/runs/{runId}", "admin"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/answer", "editor"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/approve", "editor"],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/archive", "viewer", { q: "agent=writer&path=report.md" }],
  // editor and above since S1 (a call holds a tool's inputs and outputs); a viewer is refused before any lookup
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/calls/{callId}", "editor", { ok: [404] }],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/compare", "viewer", { ok: [404] }],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/files", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/live", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/message", "editor"],
  // Session messages: Postgres only — 503 where the matrix runs without one.
  ["GET", "/v1/workspaces/{workspace}/sessions", "viewer"],
  ["PATCH", "/v1/workspaces/{workspace}/sessions/{context}", "editor", { ok: [200, 400] }],
  ["POST", "/v1/workspaces/{workspace}/sessions/{context}/messages/take", "editor", { ok: [200, 400, 503] }],
  ["GET", "/v1/workspaces/{workspace}/sessions/{context}/messages", "viewer", { ok: [200, 503] }],
  ["POST", "/v1/workspaces/{workspace}/sessions/{context}/messages", "editor", { ok: [201, 400, 409, 503] }],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/promote", "editor"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/rerun", "editor"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/stop", "editor"],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/stream", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/runs/{runId}/trace", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/runtimes", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/shares", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/shares", "editor"],
  ["DELETE", "/v1/workspaces/{workspace}/shares", "editor"],
  ["POST", "/v1/workspaces/{workspace}/snapshots", "editor"],
  ["GET", "/v1/workspaces/{workspace}/source", "viewer"],
  ["PUT", "/v1/workspaces/{workspace}/source", "editor"],
  ["PATCH", "/v1/workspaces/{workspace}/source", "editor"],
  ["DELETE", "/v1/workspaces/{workspace}/source", "editor"],
  ["POST", "/v1/workspaces/{workspace}/source/share", "editor"],
  ["GET", "/v1/workspaces/{workspace}/storage", "viewer"],
  ["POST", "/v1/workspaces/{workspace}/storage", "editor"],
  ["PUT", "/v1/workspaces/{workspace}/storage", "editor"],
  ["DELETE", "/v1/workspaces/{workspace}/storage", "editor"],
  ["GET", "/v1/workspaces/{workspace}/storage/download", "viewer", { q: "path=public/report.txt", ok: [200, 400, 404] }],
  ["POST", "/v1/workspaces/{workspace}/storage/extract", "editor"],
  ["GET", "/v1/workspaces/{workspace}/storage/preview", "viewer", { q: "path=public/report.txt", ok: [200, 400, 404] }],
  ["POST", "/v1/workspaces/{workspace}/storage/upload-url", "editor"],
  ["POST", "/v1/workspaces/{workspace}/tools/{tool}/test", "editor"],
  ["GET", "/v1/workspaces/{workspace}/triggers", "viewer"],
  ["GET", "/v1/workspaces/{workspace}/vocabulary", "viewer"],
];

/** The hosted edition's own routes (private foldrun-admin overlay: wallet, plans, card, partner top-ups, support views). Their rows count only when the files are laid over this tree (`bash foldrun-admin/overlay.sh`) and the run says FOLDRUN_EDITION=hosted; in the public tree they are not there and are skipped. */
export const OVERLAY_ROWS: Row[] = [
  ["GET", "/v1/billing", "hosted viewer"],
  ["POST", "/v1/billing", "hosted owner", { ok: [404] }],
  ["POST", "/v1/billing/card", "hosted owner"],
  ["POST", "/v1/billing/checkout", "hosted owner"],
  ["GET", "/v1/billing/coding-plan", "hosted viewer"],
  ["POST", "/v1/billing/coding-plan", "hosted owner"],
  ["PATCH", "/v1/billing/coding-plan", "hosted owner"],
  ["DELETE", "/v1/billing/coding-plan", "hosted owner"],
  ["GET", "/v1/billing/confirm", "hosted none", { ok: [307, 400, 401, 403, 404, 502] }],
  ["GET", "/v1/billing/details", "hosted viewer wide"],
  ["PUT", "/v1/billing/details", "hosted owner"],
  ["GET", "/v1/billing/invoices", "hosted viewer wide"],
  ["POST", "/v1/billing/partner/plans", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/plans/offer", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/signups", "hosted token", { ok: [400, 401, 403, 404, 429, 503] }],
  ["POST", "/v1/billing/partner/topups", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/v1/billing/partner/topups", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/v1/billing/partner/topups/{id}", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/topups/{id}/authority", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/topups/{id}/failed", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/topups/{id}/paid", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/partner/topups/quote", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/v1/billing/partner/topups/rate", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/v1/billing/plans", "hosted viewer"],
  ["POST", "/v1/billing/portal", "hosted owner"],
  ["GET", "/v1/billing/statement", "hosted viewer wide"],
  ["POST", "/v1/billing/stripe", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/v1/billing/subscribe", "hosted owner"],
  ["DELETE", "/v1/billing/subscribe", "hosted owner"],
  ["GET", "/v1/billing/wallet", "hosted viewer"],
  ["PUT", "/v1/billing/wallet", "hosted owner"],
  // A support view enters on the operator console's one-minute signed ticket, from this app's own page only.
  ["POST", "/v1/support/enter", "hosted token", { ok: [400, 401, 403, 404, 409] }],
  ["POST", "/v1/support/exit", "hosted none", { ok: [200, 400, 401, 403, 404] }],
];

/** Routes in the generated route list that this public tree has no handler for: the hosted edition's wallet, plans and partner top-ups live in the private foldrun-admin overlay and are laid over this tree at build time. */
export const OVERLAY_ONLY = /^\/v1\/billing(\/|$)/;

/** Routes another change is rewriting right now (the 14 Nov batches): classified here as "does not leak another account's data" and asserted for nothing else. */
export const IN_FLUX = new Set(["GET /v1/version", "GET /v1/healthz"]);

/** Known gaps: a cell that is wrong by the design above and has not been fixed — each with why, so it is never silent. Keyed `METHOD path as caller`. */
export const KNOWN_GAPS: Record<string, string> = {
  // INFO. The library is what every workspace inherits, so a caller limited to one workspace already uses it from there; only its writes (and the account's AGENTS.md, read and write) are account-wide. Product call: close the read too, or document it.
  "GET /v1/library/{kind} as scopedKey": "library read is open to a workspace-limited caller",
  "GET /v1/library/{kind} as scopedSession": "library read is open to a workspace-limited caller",
};

/**
 * The same routes again, this time with a REAL, destructive request aimed at
 * A's real things — A's run, A's key ids, A's members, A's secret, A's share
 * token. Whoever the design refuses must leave A exactly as it was; whoever it
 * lets in (A's own roles) really does it, and the harness puts A back after.
 * The spec is the base row's.
 */
export const REAL_WRITES: Row[] = [
  ["PUT", "/v1/workspaces/{workspace}/source", "editor", { body: { path: "AGENTS.md", content: "---\nname: desk\n---\nHIJACKED\n" } }],
  ["PATCH", "/v1/workspaces/{workspace}/source", "editor", { body: { from: "knowledge/notes.md", to: "knowledge/moved.md" } }],
  ["DELETE", "/v1/workspaces/{workspace}/source", "editor", { body: { path: "knowledge/notes.md" } }],
  ["POST", "/v1/workspaces/{workspace}/deploy", "editor", { body: { files: [{ path: "AGENTS.md", content: "---\nname: desk\n---\nHIJACKED\n" }] } }],
  ["POST", "/v1/workspaces/{workspace}/restore", "editor", { body: { to: "1 hour ago", confirm: "desk" } }],
  ["DELETE", "/v1/workspaces/{workspace}/storage", "editor", { q: "path=public/report.txt" }],
  ["POST", "/v1/workspaces/{workspace}/shares", "editor", { body: { path: "storage/public/report.txt" } }],
  ["DELETE", "/v1/workspaces/{workspace}/shares", "editor", { body: { token: SHARE.token, id: SHARE.token.slice(0, 8) }, q: `token=${SHARE.token}` }],
  ["DELETE", "/v1/workspaces/{workspace}/runs/{runId}", "admin"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/stop", "editor"],
  ["POST", "/v1/workspaces/{workspace}/runs/{runId}/rerun", "editor", { body: { confirm: true } }],
  ["PATCH", "/v1/workspaces/{workspace}", "admin", { body: { name: "renamed-by-attacker" } }],
  ["DELETE", "/v1/workspaces/{workspace}", "admin"],
  ["POST", "/v1/workspaces/{workspace}/pause", "admin", { body: { reason: "attacker" } }],
  ["POST", "/v1/workspaces/{workspace}/hooks/{flow}/rotate", "admin"],
  ["PUT", "/v1/secrets", "admin", { body: { name: "EVIL_TOKEN", value: "evil", workspace: "desk" } }],
  ["DELETE", "/v1/secrets", "admin", { body: { name: A.secretName, workspace: "desk" }, q: `name=${A.secretName}&workspace=desk` }],
  ["DELETE", "/v1/keys", "admin", { body: { id: IDS.keyAdmin } }],
  ["POST", "/v1/keys/{id}/rotate", "admin", { params: { id: IDS.keyViewer }, body: { grace: 0 } }],
  ["DELETE", "/v1/keys/{id}", "admin", { params: { id: IDS.keyViewer } }],
  ["PATCH", "/v1/keys/{id}", "admin wide", { params: { id: IDS.keyViewer }, body: { label: "taken", role: "admin" } }],
  ["POST", "/v1/keys", "admin", { body: { label: "minted-by-attacker", role: "admin" } }],
  ["PATCH", "/v1/team/members/{id}", "admin person", { params: { id: IDS.viewer }, body: { role: "admin" } }],
  ["PATCH", "/v1/team/members/{id}", "admin person", { params: { id: IDS.owner }, body: { role: "viewer" } }],
  ["DELETE", "/v1/team/members/{id}", "admin person", { params: { id: IDS.editor } }],
  ["DELETE", "/v1/team/members/{id}", "admin person", { params: { id: IDS.owner } }],
  ["POST", "/v1/team/transfer", "owner person", { body: { to: IDS.viewer, password: A.password } }],
  ["POST", "/v1/team", "admin person", { body: { email: "planted@attacker.test", role: "admin" } }],
  ["PATCH", "/v1/account", "admin wide", { body: { timezone: "Pacific/Auckland" } }],
  ["PUT", "/v1/account/agents-md", "admin wide", { body: { content: "---\nname: acct\n---\nHIJACKED\n" } }],
  ["PUT", "/v1/library/{kind}", "editor wide", { params: { kind: "knowledge" }, body: { path: "shared.md", content: "HIJACKED" } }],
  ["DELETE", "/v1/library/{kind}", "editor wide", { params: { kind: "knowledge" }, body: { path: "shared.md" } }],
  ["POST", "/v1/account/pause", "admin wide", { body: { reason: "attacker" } }],
];
