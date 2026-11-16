// The authorization matrix, as data: for every API route and method, who may
// call it, from the documented design — foldrun-docs api.md, the role
// standard (platform permissions.ts: viewer reads, editor works, admin runs
// the account, owner pays), and the guard each handler calls (requireTenant /
// requireCaller = any signed-in role; requirePermission(action); requirePerson
// = a signed-in person, not a hand-made key; requireSession / requireOwner =
// the cookie; requireAccountWide = no workspace limit). authz-matrix.test.ts
// turns each row into one expected status per kind of caller, and fails when a
// route in app/api has no row, so a new route cannot slip in unclassified.
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
// A workspace route (/api/workspaces/{workspace}/…) is refused to a caller
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
  ["GET", "/api/account", "viewer"],
  ["PATCH", "/api/account", "admin wide"],
  ["GET", "/api/account/agents-md", "viewer wide"],
  ["PUT", "/api/account/agents-md", "admin wide"],
  ["GET", "/api/account/api", "viewer"],
  ["PATCH", "/api/account/api", "admin wide"],
  ["GET", "/api/account/backups", "viewer"],
  ["GET", "/api/account/backups/requests", "viewer"],
  ["POST", "/api/account/backups/requests", "admin"],
  ["POST", "/api/account/close", "hosted owner ownerOnly"],
  ["GET", "/api/account/export", "owner"],
  ["GET", "/api/account/flags", "viewer"],
  ["GET", "/api/account/jobs", "viewer"],
  ["GET", "/api/account/model", "viewer"],
  ["PUT", "/api/account/model", "admin wide"],
  ["DELETE", "/api/account/model", "admin wide"],
  ["GET", "/api/account/pause", "viewer"],
  ["POST", "/api/account/pause", "admin wide"],
  ["DELETE", "/api/account/pause", "admin wide"],
  ["GET", "/api/account/providers", "viewer"],
  ["POST", "/api/account/providers", "editor wide"],
  ["POST", "/api/account/telemetry/test", "admin wide"],
  ["GET", "/api/approvals", "viewer"],
  ["GET", "/api/assistant/conversations", "viewer"],
  ["GET", "/api/assistant/conversations/{id}", "viewer", { ok: [404] }],
  ["DELETE", "/api/assistant/conversations/{id}", "viewer", { ok: [404] }],
  ["GET", "/api/audit", "admin wide"],
  ["GET", "/api/changelog", "viewer"],
  ["GET", "/api/customers", "viewer"],
  ["PATCH", "/api/customers", "admin wide"],
  ["PUT", "/api/customers/{customer}/block", "admin wide"],
  ["DELETE", "/api/customers/{customer}/block", "admin wide"],
  ["GET", "/api/customers/usage", "viewer"],
  ["GET", "/api/identity", "viewer"],
  ["GET", "/api/insights", "viewer"],
  ["GET", "/api/issues", "viewer"],
  ["GET", "/api/issues/{id}", "viewer", { ok: [404] }],
  ["POST", "/api/issues/{id}", "editor"],
  ["GET", "/api/observe", "viewer"],
  ["GET", "/api/schedule", "viewer"],
  ["POST", "/api/schedule", "admin wide"],
  ["GET", "/api/search", "viewer", { q: "q=canary" }],
  ["GET", "/api/usage", "viewer"],
  ["GET", "/api/usage/budget", "viewer"],
  ["GET", "/api/usage/compute", "viewer"],
  ["GET", "/api/usage/history", "viewer"],
  ["GET", "/api/usage/rates", "viewer"],
  ["GET", "/api/me", "viewer"],
  ["GET", "/api/me/inbox", "viewer"],
  ["POST", "/api/me/inbox", "viewer"],
  ["GET", "/api/me/notifications", "viewer"],
  ["PATCH", "/api/me/notifications", "viewer"],
  ["GET", "/api/me/onboarding", "viewer"],
  ["PATCH", "/api/me/onboarding", "session"],
  ["GET", "/api/me/preferences", "viewer"],
  ["PATCH", "/api/me/preferences", "viewer"],
  ["POST", "/api/extract", "editor", { ok: [200, 202, 400, 404, 411, 413, 415, 422, 501, 503] }],
  ["GET", "/api/extract/{id}", "viewer", { ok: [404] }],
  ["GET", "/api/library/{kind}", "viewer wide", { params: { kind: "knowledge" } }],
  ["POST", "/api/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["PUT", "/api/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["DELETE", "/api/library/{kind}", "editor wide", { params: { kind: "knowledge" } }],
  ["GET", "/api/library/gallery", "viewer"],
  ["POST", "/api/library/gallery", "editor wide"],
  ["GET", "/api/avatars/{kind}/{id}", "viewer", { params: { kind: "account", id: A.tenant }, ok: [200, 404] }],
  ["PUT", "/api/avatars/{kind}/{id}", "admin wide", { params: { kind: "account", id: A.tenant } }],
  ["DELETE", "/api/avatars/{kind}/{id}", "admin wide", { params: { kind: "account", id: A.tenant } }],

  // ---- keys, team, sign-in ---------------------------------------------------
  ["GET", "/api/keys", "admin"],
  ["POST", "/api/keys", "admin"],
  ["DELETE", "/api/keys", "admin", { body: { id: "no-such-key" } }],
  ["PATCH", "/api/keys/{id}", "admin wide", { params: { id: "no-such-key" } }],
  ["POST", "/api/keys/{id}/rotate", "admin", { params: { id: "no-such-key" } }],
  ["GET", "/api/team", "viewer"],
  ["POST", "/api/team", "admin person"],
  ["GET", "/api/team/invites", "admin"],
  ["DELETE", "/api/team/invites/{id}", "admin", { ok: [404] }],
  ["PATCH", "/api/team/members/{id}", "admin person", { ok: [404, 400] }],
  ["DELETE", "/api/team/members/{id}", "admin person", { ok: [404, 400] }],
  ["POST", "/api/team/transfer", "owner person"],
  ["POST", "/api/auth/email", "session"],
  ["POST", "/api/auth/forgot", "none", { ok: [200, 400, 429] }],
  ["POST", "/api/auth/login", "none", { ok: [400, 401, 429] }],
  ["POST", "/api/auth/logout", "none"],
  ["POST", "/api/auth/mfa/disable", "session", { ok: [400, 401, 403] }],
  ["POST", "/api/auth/mfa/enable", "session"],
  ["POST", "/api/auth/mfa/setup", "session"],
  ["POST", "/api/auth/mfa/verify", "none", { ok: [400, 401, 429] }],
  ["POST", "/api/auth/name", "session"],
  ["POST", "/api/auth/password", "session"],
  ["POST", "/api/auth/reset", "none", { ok: [400, 401, 429] }],
  ["GET", "/api/auth/session", "none"],
  ["GET", "/api/auth/sessions", "session"],
  ["DELETE", "/api/auth/sessions", "session"],
  ["POST", "/api/auth/signup", "none", { ok: [400, 403, 429] }],
  ["POST", "/api/auth/timezone", "session"],
  ["GET", "/api/auth/verify", "none", { ok: [302, 307, 400] }],
  ["POST", "/api/auth/verify/resend", "session"],
  ["GET", "/api/cli/authorize", "none", { ok: [404, 400, 307] }],
  ["POST", "/api/cli/authorize", "session"],
  ["POST", "/api/cli/login", "none"],
  ["GET", "/api/cli/login/{id}", "none", { ok: [200, 404] }],
  ["POST", "/api/mcp", "keyOnly", { ok: [200, 202, 400, 404, 405] }],
  ["POST", "/api/mcp/clients", "admin"],
  ["GET", "/api/mcp/connections", "viewer"],
  ["DELETE", "/api/mcp/connections/{id}", "viewer", { ok: [404] }],
  ["GET", "/api/mcp/oauth/authorize", "session", { ok: [400, 302, 307] }],
  ["POST", "/api/mcp/oauth/authorize", "session"],
  ["POST", "/api/mcp/oauth/register", "none"],
  ["POST", "/api/mcp/oauth/revoke", "none", { ok: [200, 400, 401] }],
  ["POST", "/api/mcp/oauth/token", "none", { ok: [400, 401] }],
  ["GET", "/api/oauth/callback", "none", { ok: [302, 307, 400] }],
  ["GET", "/api/oauth/clients", "viewer"],
  ["POST", "/api/oauth/clients", "admin wide"],
  ["DELETE", "/api/oauth/clients", "admin wide"],
  ["GET", "/api/oauth/connections", "viewer"],
  ["POST", "/api/oauth/device", "admin"],
  ["POST", "/api/oauth/device/{id}", "admin"],
  ["POST", "/api/oauth/discover", "admin"],
  ["POST", "/api/oauth/handoff/{id}", "admin person", { ok: [404, 400] }],
  ["POST", "/api/oauth/reconnect", "admin"],
  ["POST", "/api/oauth/start", "admin"],
  ["GET", "/api/secrets", "viewer wide"],
  ["PUT", "/api/secrets", "admin"],
  ["PATCH", "/api/secrets", "admin"],
  ["DELETE", "/api/secrets", "admin"],
  ["POST", "/api/unsubscribe", "none", { ok: [400, 403, 404] }],

  // ---- links whose token is the credential ----------------------------------
  ["GET", "/api/approve/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/api/approve/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/api/events/{tenant}/{workspace}/{runId}", "token", { q: "token=forged" }],
  ["POST", "/api/hooks/{tenant}/{workspace}/{flow}", "token", { q: "token=forged" }],
  ["POST", "/api/inbox/{tenant}/{workspace}/{flow}", "token", { q: "token=forged" }],

  // ---- public ---------------------------------------------------------------
  ["GET", "/api/healthz", "none"],
  ["GET", "/api/metrics", "token", { ok: [404] }],
  ["GET", "/api/openapi.json", "none"],
  ["GET", "/api/pricing", "none", { ok: [200, 404] }],
  ["GET", "/api/signup", "none"],
  ["GET", "/api/status", "none"],
  ["GET", "/api/status/history", "none"],
  ["GET", "/api/version", "none"],

  // ---- workspaces -------------------------------------------------------------
  ["GET", "/api/workspaces", "viewer"],
  ["POST", "/api/workspaces", "admin"],
  ["GET", "/api/workspaces/{workspace}", "viewer"],
  ["PATCH", "/api/workspaces/{workspace}", "admin"],
  ["DELETE", "/api/workspaces/{workspace}", "admin"],
  ["GET", "/api/workspaces/{workspace}/a2a", "viewer"],
  ["GET", "/api/workspaces/{workspace}/agents", "viewer"],
  ["POST", "/api/workspaces/{workspace}/agents", "editor"],
  ["PATCH", "/api/workspaces/{workspace}/agents/{agent}", "editor"],
  ["POST", "/api/workspaces/{workspace}/agents/{agent}/run", "editor"],
  ["GET", "/api/workspaces/{workspace}/agents/import", "viewer"],
  ["POST", "/api/workspaces/{workspace}/agents/import", "editor"],
  ["POST", "/api/workspaces/{workspace}/assets", "editor"],
  ["POST", "/api/workspaces/{workspace}/assistant", "editor"],
  ["GET", "/api/workspaces/{workspace}/check", "viewer"],
  ["POST", "/api/workspaces/{workspace}/deploy", "editor"],
  ["GET", "/api/workspaces/{workspace}/evals", "viewer"],
  ["POST", "/api/workspaces/{workspace}/evals", "editor"],
  ["GET", "/api/workspaces/{workspace}/evals/{evalName}/compare", "viewer"],
  ["POST", "/api/workspaces/{workspace}/evals/{evalName}/compare", "editor"],
  ["POST", "/api/workspaces/{workspace}/evals/{evalName}/grade", "editor"],
  ["GET", "/api/workspaces/{workspace}/evals/{evalName}/grades", "viewer", { ok: [200, 400] }],
  ["POST", "/api/workspaces/{workspace}/evals/{evalName}/improve", "editor"],
  ["GET", "/api/workspaces/{workspace}/evals/{evalName}/run", "viewer"],
  ["POST", "/api/workspaces/{workspace}/evals/{evalName}/run", "editor"],
  ["GET", "/api/workspaces/{workspace}/evals/trends", "viewer"],
  ["GET", "/api/workspaces/{workspace}/export", "viewer"],
  ["GET", "/api/workspaces/{workspace}/flows", "viewer"],
  ["POST", "/api/workspaces/{workspace}/flows", "editor"],
  ["PATCH", "/api/workspaces/{workspace}/flows/{flow}", "editor"],
  ["POST", "/api/workspaces/{workspace}/flows/{flow}/filter", "viewer"],
  ["POST", "/api/workspaces/{workspace}/flows/{flow}/run", "editor"],
  ["POST", "/api/workspaces/{workspace}/flows/draft", "editor"],
  ["PATCH", "/api/workspaces/{workspace}/flows/draft", "editor"],
  ["DELETE", "/api/workspaces/{workspace}/flows/draft", "gone"],
  ["GET", "/api/workspaces/{workspace}/history", "viewer"],
  ["GET", "/api/workspaces/{workspace}/hooks", "viewer"],
  ["GET", "/api/workspaces/{workspace}/hooks/{flow}", "admin"],
  ["POST", "/api/workspaces/{workspace}/hooks/{flow}/rotate", "admin"],
  ["POST", "/api/workspaces/{workspace}/hooks/{flow}/test", "editor"],
  ["POST", "/api/workspaces/{workspace}/import", "editor"],
  ["GET", "/api/workspaces/{workspace}/notify/deliveries", "viewer"],
  ["POST", "/api/workspaces/{workspace}/notify/deliveries/{id}/redeliver", "editor", { ok: [404] }],
  ["POST", "/api/workspaces/{workspace}/notify/test", "editor"],
  ["GET", "/api/workspaces/{workspace}/observe", "viewer"],
  ["GET", "/api/workspaces/{workspace}/pause", "viewer"],
  ["POST", "/api/workspaces/{workspace}/pause", "admin"],
  ["DELETE", "/api/workspaces/{workspace}/pause", "admin"],
  ["GET", "/api/workspaces/{workspace}/proposals", "viewer"],
  ["GET", "/api/workspaces/{workspace}/proposals/{id}", "viewer", { ok: [400, 404] }],
  ["POST", "/api/workspaces/{workspace}/proposals/{id}", "editor"],
  ["POST", "/api/workspaces/{workspace}/restore", "editor"],
  ["GET", "/api/workspaces/{workspace}/runs", "viewer"],
  ["POST", "/api/workspaces/{workspace}/runs/bulk", "editor"],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}", "viewer"],
  ["DELETE", "/api/workspaces/{workspace}/runs/{runId}", "admin"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/answer", "editor"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/approve", "editor"],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/archive", "viewer", { q: "agent=writer&path=report.md" }],
  // editor and above since S1 (a call holds a tool's inputs and outputs); a viewer is refused before any lookup
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/calls/{callId}", "editor", { ok: [404] }],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/compare", "viewer", { ok: [404] }],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/files", "viewer"],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/live", "viewer"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/message", "editor"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/promote", "editor"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/rerun", "editor"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/stop", "editor"],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/stream", "viewer"],
  ["GET", "/api/workspaces/{workspace}/runs/{runId}/trace", "viewer"],
  ["GET", "/api/workspaces/{workspace}/runtimes", "viewer"],
  ["GET", "/api/workspaces/{workspace}/shares", "viewer"],
  ["POST", "/api/workspaces/{workspace}/shares", "editor"],
  ["DELETE", "/api/workspaces/{workspace}/shares", "editor"],
  ["POST", "/api/workspaces/{workspace}/snapshots", "editor"],
  ["GET", "/api/workspaces/{workspace}/source", "viewer"],
  ["PUT", "/api/workspaces/{workspace}/source", "editor"],
  ["PATCH", "/api/workspaces/{workspace}/source", "editor"],
  ["DELETE", "/api/workspaces/{workspace}/source", "editor"],
  ["POST", "/api/workspaces/{workspace}/source/share", "editor"],
  ["GET", "/api/workspaces/{workspace}/storage", "viewer"],
  ["POST", "/api/workspaces/{workspace}/storage", "editor"],
  ["PUT", "/api/workspaces/{workspace}/storage", "editor"],
  ["DELETE", "/api/workspaces/{workspace}/storage", "editor"],
  ["GET", "/api/workspaces/{workspace}/storage/download", "viewer", { q: "path=public/report.txt", ok: [200, 400, 404] }],
  ["POST", "/api/workspaces/{workspace}/storage/extract", "editor"],
  ["GET", "/api/workspaces/{workspace}/storage/preview", "viewer", { q: "path=public/report.txt", ok: [200, 400, 404] }],
  ["POST", "/api/workspaces/{workspace}/storage/upload-url", "editor"],
  ["POST", "/api/workspaces/{workspace}/tools/{tool}/test", "editor"],
  ["GET", "/api/workspaces/{workspace}/triggers", "viewer"],
  ["GET", "/api/workspaces/{workspace}/vocabulary", "viewer"],
];

/** The hosted edition's own routes (private foldrun-admin overlay: wallet, plans, card, partner top-ups, support views). Their rows count only when the files are laid over this tree (`bash foldrun-admin/overlay.sh`) and the run says FOLDRUN_EDITION=hosted; in the public tree they are not there and are skipped. */
export const OVERLAY_ROWS: Row[] = [
  ["GET", "/api/billing", "hosted viewer"],
  ["POST", "/api/billing", "hosted owner", { ok: [404] }],
  ["POST", "/api/billing/card", "hosted owner"],
  ["POST", "/api/billing/checkout", "hosted owner"],
  ["GET", "/api/billing/coding-plan", "hosted viewer"],
  ["POST", "/api/billing/coding-plan", "hosted owner"],
  ["PATCH", "/api/billing/coding-plan", "hosted owner"],
  ["DELETE", "/api/billing/coding-plan", "hosted owner"],
  ["GET", "/api/billing/confirm", "hosted none", { ok: [307, 400, 401, 403, 404, 502] }],
  ["GET", "/api/billing/details", "hosted viewer wide"],
  ["PUT", "/api/billing/details", "hosted owner"],
  ["GET", "/api/billing/invoices", "hosted viewer wide"],
  ["POST", "/api/billing/partner/plans", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/plans/offer", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/signups", "hosted token", { ok: [400, 401, 403, 404, 429, 503] }],
  ["POST", "/api/billing/partner/topups", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/api/billing/partner/topups", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/api/billing/partner/topups/{id}", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/topups/{id}/authority", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/topups/{id}/failed", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/topups/{id}/paid", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/partner/topups/quote", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/api/billing/partner/topups/rate", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["GET", "/api/billing/plans", "hosted viewer"],
  ["POST", "/api/billing/portal", "hosted owner"],
  ["GET", "/api/billing/statement", "hosted viewer wide"],
  ["POST", "/api/billing/stripe", "hosted token", { ok: [400, 401, 403, 404, 503] }],
  ["POST", "/api/billing/subscribe", "hosted owner"],
  ["DELETE", "/api/billing/subscribe", "hosted owner"],
  ["GET", "/api/billing/wallet", "hosted viewer"],
  ["PUT", "/api/billing/wallet", "hosted owner"],
  // A support view enters on the operator console's one-minute signed ticket, from this app's own page only.
  ["POST", "/api/support/enter", "hosted token", { ok: [400, 401, 403, 404, 409] }],
  ["POST", "/api/support/exit", "hosted none", { ok: [200, 400, 401, 403, 404] }],
];

/** Routes in the generated route list that this public tree has no handler for: the hosted edition's wallet, plans and partner top-ups live in the private foldrun-admin overlay and are laid over this tree at build time. */
export const OVERLAY_ONLY = /^\/api\/billing(\/|$)/;

/** Routes another change is rewriting right now (the 14 Nov batches): classified here as "does not leak another account's data" and asserted for nothing else. */
export const IN_FLUX = new Set(["GET /api/version", "GET /api/healthz"]);

/** Known gaps: a cell that is wrong by the design above and has not been fixed — each with why, so it is never silent. Keyed `METHOD path as caller`. */
export const KNOWN_GAPS: Record<string, string> = {
  // INFO. The library is what every workspace inherits, so a caller limited to one workspace already uses it from there; only its writes (and the account's AGENTS.md, read and write) are account-wide. Product call: close the read too, or document it.
  "GET /api/library/{kind} as scopedKey": "library read is open to a workspace-limited caller",
  "GET /api/library/{kind} as scopedSession": "library read is open to a workspace-limited caller",
};

/**
 * The same routes again, this time with a REAL, destructive request aimed at
 * A's real things — A's run, A's key ids, A's members, A's secret, A's share
 * token. Whoever the design refuses must leave A exactly as it was; whoever it
 * lets in (A's own roles) really does it, and the harness puts A back after.
 * The spec is the base row's.
 */
export const REAL_WRITES: Row[] = [
  ["PUT", "/api/workspaces/{workspace}/source", "editor", { body: { path: "AGENTS.md", content: "---\nname: desk\n---\nHIJACKED\n" } }],
  ["PATCH", "/api/workspaces/{workspace}/source", "editor", { body: { from: "knowledge/notes.md", to: "knowledge/moved.md" } }],
  ["DELETE", "/api/workspaces/{workspace}/source", "editor", { body: { path: "knowledge/notes.md" } }],
  ["POST", "/api/workspaces/{workspace}/deploy", "editor", { body: { files: [{ path: "AGENTS.md", content: "---\nname: desk\n---\nHIJACKED\n" }] } }],
  ["POST", "/api/workspaces/{workspace}/restore", "editor", { body: { to: "1 hour ago", confirm: "desk" } }],
  ["DELETE", "/api/workspaces/{workspace}/storage", "editor", { q: "path=public/report.txt" }],
  ["POST", "/api/workspaces/{workspace}/shares", "editor", { body: { path: "storage/public/report.txt" } }],
  ["DELETE", "/api/workspaces/{workspace}/shares", "editor", { body: { token: SHARE.token, id: SHARE.token.slice(0, 8) }, q: `token=${SHARE.token}` }],
  ["DELETE", "/api/workspaces/{workspace}/runs/{runId}", "admin"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/stop", "editor"],
  ["POST", "/api/workspaces/{workspace}/runs/{runId}/rerun", "editor", { body: { confirm: true } }],
  ["PATCH", "/api/workspaces/{workspace}", "admin", { body: { name: "renamed-by-attacker" } }],
  ["DELETE", "/api/workspaces/{workspace}", "admin"],
  ["POST", "/api/workspaces/{workspace}/pause", "admin", { body: { reason: "attacker" } }],
  ["POST", "/api/workspaces/{workspace}/hooks/{flow}/rotate", "admin"],
  ["PUT", "/api/secrets", "admin", { body: { name: "EVIL_TOKEN", value: "evil", workspace: "desk" } }],
  ["DELETE", "/api/secrets", "admin", { body: { name: A.secretName, workspace: "desk" }, q: `name=${A.secretName}&workspace=desk` }],
  ["DELETE", "/api/keys", "admin", { body: { id: IDS.keyAdmin } }],
  ["POST", "/api/keys/{id}/rotate", "admin", { params: { id: IDS.keyViewer }, body: { grace: 0 } }],
  ["PATCH", "/api/keys/{id}", "admin wide", { params: { id: IDS.keyViewer }, body: { label: "taken", role: "admin" } }],
  ["POST", "/api/keys", "admin", { body: { label: "minted-by-attacker", role: "admin" } }],
  ["PATCH", "/api/team/members/{id}", "admin person", { params: { id: IDS.viewer }, body: { role: "admin" } }],
  ["PATCH", "/api/team/members/{id}", "admin person", { params: { id: IDS.owner }, body: { role: "viewer" } }],
  ["DELETE", "/api/team/members/{id}", "admin person", { params: { id: IDS.editor } }],
  ["DELETE", "/api/team/members/{id}", "admin person", { params: { id: IDS.owner } }],
  ["POST", "/api/team/transfer", "owner person", { body: { to: IDS.viewer, password: A.password } }],
  ["POST", "/api/team", "admin person", { body: { email: "planted@attacker.test", role: "admin" } }],
  ["PATCH", "/api/account", "admin wide", { body: { timezone: "Pacific/Auckland" } }],
  ["PUT", "/api/account/agents-md", "admin wide", { body: { content: "---\nname: acct\n---\nHIJACKED\n" } }],
  ["PUT", "/api/library/{kind}", "editor wide", { params: { kind: "knowledge" }, body: { path: "shared.md", content: "HIJACKED" } }],
  ["DELETE", "/api/library/{kind}", "editor wide", { params: { kind: "knowledge" }, body: { path: "shared.md" } }],
  ["POST", "/api/account/pause", "admin wide", { body: { reason: "attacker" } }],
];
