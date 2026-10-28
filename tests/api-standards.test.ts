// The conventions every API route shares: rate limits (headers and 429),
// Idempotency-Key (replay and mismatch), dated versions (echo, 400, pin) and
// the OpenAPI document (every route in it, nothing invented).
//
//   node --import ./tests/register.mjs --test tests/api-standards.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-apistd-"));
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_API_RATE_LIMIT;

const { createApiKey } = await import("../server/auth.ts");
const { apiGate, resetApiGateCaches, TIERS, ACCOUNT_MULTIPLE, limitsFor } = await import("../server/api-limits.ts");
const { idempotent, resetIdempotencyMemory } = await import("../server/idempotency.ts");
const V = await import("../server/api-version.ts");
const { updateAdminState } = await import("@/platform/admin");
const { openapiDocument } = await import("../server/openapi.ts");
const { ROUTES } = await import("../server/openapi-routes.ts");
const gen = await import("../scripts/gen-openapi.mjs");
const { billingPresent, isBillingRoute } = await import("./billing-files.ts");

const BASE = "http://localhost:3900";
const req = (method: string, p: string, key?: string, headers: Record<string, string> = {}, body?: string) =>
  new NextRequest(`${BASE}${p}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    ...(body !== undefined ? { body } : {}),
  });

// ------------------------------------------------------------ rate limits

test("every authenticated answer carries X-RateLimit-*; the write bucket refuses with 429 and Retry-After", async () => {
  resetApiGateCaches();
  const { key } = await createApiKey("ratey", "ci", undefined, undefined, "editor");
  const limit = TIERS.free.write;
  let last;
  for (let i = 0; i < limit; i++) {
    last = await apiGate(req("POST", "/api/workspaces/w/flows/f/run", key));
    assert.equal(last.refuse, undefined, `request ${i + 1} of ${limit} is allowed`);
  }
  assert.equal(last!.headers["x-ratelimit-limit"], String(limit));
  assert.equal(last!.headers["x-ratelimit-remaining"], "0");
  assert.ok(Number(last!.headers["x-ratelimit-reset"]) > Date.now() / 1000);

  const over = await apiGate(req("POST", "/api/workspaces/w/flows/f/run", key));
  assert.ok(over.refuse);
  assert.equal(over.refuse!.status, 429);
  const body = (await over.refuse!.json()) as { error: string; retry_after: number };
  assert.match(body.error, /rate limit/);
  assert.ok(body.retry_after > 0 && body.retry_after <= 60);
  assert.equal(over.headers["retry-after"], String(body.retry_after));

  // Reads are their own bucket: a spent write budget does not stop a GET.
  const read = await apiGate(req("GET", "/api/workspaces/w/runs", key));
  assert.equal(read.refuse, undefined);
  assert.equal(read.headers["x-ratelimit-limit"], String(TIERS.free.read));
});

test("the account bucket holds across keys: many keys are not many allowances", async () => {
  resetApiGateCaches();
  const keys = await Promise.all(Array.from({ length: ACCOUNT_MULTIPLE + 1 }, (_, i) => createApiKey("crowd", `k${i}`, undefined, undefined, "editor")));
  const perKey = TIERS.free.write;
  let refused = 0;
  for (const { key } of keys) {
    for (let i = 0; i < perKey; i++) if ((await apiGate(req("POST", "/api/keys", key))).refuse) refused++;
  }
  assert.equal(refused, perKey, "the last key finds the account's bucket empty");
});

test("no credential, no counting — the route answers 401 itself", async () => {
  const g = await apiGate(req("POST", "/api/workspaces/w/deploy"));
  assert.equal(g.refuse, undefined);
  assert.equal(g.headers["x-ratelimit-limit"], undefined);
  assert.equal(g.headers["foldrun-version"], V.CURRENT_API_VERSION);
});

test("FOLDRUN_API_RATE_LIMIT=off stops counting", async () => {
  resetApiGateCaches();
  process.env.FOLDRUN_API_RATE_LIMIT = "off";
  try {
    const { key } = await createApiKey("unmetered", "ci", undefined, undefined, "editor");
    for (let i = 0; i < TIERS.free.write + 5; i++) assert.equal((await apiGate(req("POST", "/api/keys", key))).refuse, undefined);
  } finally {
    delete process.env.FOLDRUN_API_RATE_LIMIT;
  }
});

test("limits scale with the plan, and the account's is a multiple of the key's", () => {
  assert.ok(TIERS.scale.read > TIERS.pro.read && TIERS.pro.read > TIERS.creator.read && TIERS.creator.read > TIERS.starter.read && TIERS.starter.read > TIERS.free.read);
  for (const t of Object.values(TIERS)) assert.ok(t.write < t.read, "writes are the scarcer bucket");
  const l = limitsFor("pro");
  assert.equal(l.perAccount.write, TIERS.pro.write * ACCOUNT_MULTIPLE);
  assert.equal(l.windowSeconds, 60);
});

// ------------------------------------------------------------ idempotency

test("Idempotency-Key: the same key and body replays the first answer; a different body is a 422", async () => {
  resetIdempotencyMemory();
  const { key } = await createApiKey("idem", "ci", undefined, undefined, "editor");
  let runs = 0;
  const handler = async () => NextResponse.json({ runId: `run-${++runs}` }, { status: 201 });
  const send = (body: string, k = "abc-1") => idempotent(req("POST", "/api/workspaces/w/flows/f/run", key, { "idempotency-key": k, "content-type": "application/json" }, body), handler);

  const first = await send('{"task":"x"}');
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { runId: "run-1" });
  assert.equal(first.headers.get("idempotent-replayed"), null);

  const again = await send('{"task":"x"}');
  assert.equal(again.status, 201, "the original status");
  assert.deepEqual(await again.json(), { runId: "run-1" }, "the original body — no second run");
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(runs, 1);

  const other = await send('{"task":"y"}');
  assert.equal(other.status, 422);
  assert.match(((await other.json()) as { error: string }).error, /different request body/);
  assert.equal(runs, 1);

  // A new key is a new request.
  assert.deepEqual(await (await send('{"task":"x"}', "abc-2")).json(), { runId: "run-2" });
});

test("Idempotency-Key: absent runs every time; a 5xx is not remembered; keys are per account", async () => {
  resetIdempotencyMemory();
  const a = await createApiKey("idem-a", "ci", undefined, undefined, "editor");
  const b = await createApiKey("idem-b", "ci", undefined, undefined, "editor");
  let n = 0;
  const ok = async () => NextResponse.json({ n: ++n });
  await idempotent(req("POST", "/api/keys", a.key, {}, "{}"), ok);
  await idempotent(req("POST", "/api/keys", a.key, {}, "{}"), ok);
  assert.equal(n, 2, "no key, no dedupe");

  let fails = 0;
  const boom = async () => {
    fails++;
    return NextResponse.json({ error: "x" }, { status: 503 });
  };
  await idempotent(req("POST", "/api/keys", a.key, { "idempotency-key": "k" }, "{}"), boom);
  await idempotent(req("POST", "/api/keys", a.key, { "idempotency-key": "k" }, "{}"), boom);
  assert.equal(fails, 2, "a server failure leaves the key free for a real retry");

  n = 0;
  await idempotent(req("POST", "/api/keys", a.key, { "idempotency-key": "shared" }, "{}"), ok);
  await idempotent(req("POST", "/api/keys", b.key, { "idempotency-key": "shared" }, "{}"), ok);
  assert.equal(n, 2, "another account's key of the same name is its own");

  const long = await idempotent(req("POST", "/api/keys", a.key, { "idempotency-key": "x".repeat(300) }, "{}"), ok);
  assert.equal(long.status, 400);
});

test("every side-effect POST the brief names answers through idempotent()", () => {
  const must = [
    "POST /api/workspaces/{workspace}/agents/{agent}/run",
    "POST /api/workspaces/{workspace}/evals/{evalName}/run",
    "POST /api/workspaces/{workspace}/flows/{flow}/run",
    "POST /api/workspaces/{workspace}/runs/{runId}/rerun",
    "POST /api/workspaces/{workspace}/deploy",
    "POST /api/workspaces/{workspace}/assets",
    "POST /api/workspaces/{workspace}/flows",
    "PUT /api/secrets",
    "POST /api/keys",
    "POST /api/workspaces/{workspace}/runs/{runId}/approve",
    "POST /api/workspaces/{workspace}/runs/{runId}/answer",
    "POST /api/workspaces/{workspace}/runs/{runId}/message",
    "POST /api/billing/checkout",
    "POST /api/billing/subscribe",
    "POST /api/billing/card",
    "POST /api/billing/portal",
    "POST /api/workspaces/{workspace}/flows/{flow}",
    "POST /api/workspaces/{workspace}/flows/draft",
    "POST /api/workspaces/{workspace}/hooks/{flow}/rotate",
    "POST /api/workspaces/{workspace}/notify/test",
    "POST /api/workspaces/{workspace}/runs/{runId}/stop",
    "POST /api/library/gallery",
    "POST /api/oauth/start",
    "POST /api/oauth/reconnect",
    "POST /api/oauth/clients",
  ];
  const have = new Set(ROUTES.flatMap((r) => (r.idempotent ?? []).map((m) => `${m} ${r.path}`)));
  assert.deepEqual(must.filter((m) => !have.has(m)), []);
});

// --------------------------------------------------------------- versions

test("Foldrun-Version: echoed, unknown is a 400, malformed is a 400", async () => {
  resetApiGateCaches();
  const { key } = await createApiKey("versioned", "ci", undefined, undefined, "editor");
  const ok = await apiGate(req("GET", "/api/workspaces", key, { "foldrun-version": V.CURRENT_API_VERSION }));
  assert.equal(ok.refuse, undefined);
  assert.equal(ok.headers["foldrun-version"], V.CURRENT_API_VERSION);
  assert.equal(ok.requestHeaders[V.RESOLVED_VERSION_HEADER], V.CURRENT_API_VERSION);

  const unknown = await apiGate(req("GET", "/api/workspaces", key, { "foldrun-version": "2001-01-01" }));
  assert.equal(unknown.refuse?.status, 400);
  const refused = (await unknown.refuse!.json()) as { error: string; code: string; known: string[] };
  assert.match(refused.error, /unknown API version 2001-01-01/);
  // What the CLI reads to say "update me" or "this server is older", not the English.
  assert.equal(refused.code, "unknown_api_version");
  assert.deepEqual(refused.known, V.releasedVersions());

  const bad = await apiGate(req("GET", "/api/workspaces", key, { "foldrun-version": "latest" }));
  assert.equal(bad.refuse?.status, 400);
  assert.equal(((await bad.refuse!.json()) as { code: string }).code, "bad_api_version");
  // Open routes too: the header is checked before anything else.
  assert.equal((await apiGate(req("GET", "/api/healthz", undefined, { "foldrun-version": "nope" }))).refuse?.status, 400);
});

test("the account's pin answers requests that send no header", async () => {
  const known = [V.CURRENT_API_VERSION, "2026-01-15"];
  assert.deepEqual(V.resolveVersion(null, "2026-01-15", known), { version: "2026-01-15" });
  assert.deepEqual(V.resolveVersion(V.CURRENT_API_VERSION, "2026-01-15", known), { version: V.CURRENT_API_VERSION }, "the header beats the pin");
  assert.deepEqual(V.resolveVersion(null, "2020-02-02", known), { version: V.CURRENT_API_VERSION }, "a retired pin falls forward");
  assert.deepEqual(V.resolveVersion(null, null, known), { version: V.CURRENT_API_VERSION });

  // End to end through the stored pin.
  resetApiGateCaches();
  const { key } = await createApiKey("pinned", "ci", undefined, undefined, "editor");
  await updateAdminState("pinned", { apiVersion: V.CURRENT_API_VERSION }, "test", "api-version");
  const g = await apiGate(req("GET", "/api/workspaces", key));
  assert.equal(g.headers["foldrun-version"], V.CURRENT_API_VERSION);
});

test("the pin is for keys: the dashboard always gets the current version", async () => {
  // A pin is code the account wrote against an older API. The dashboard ships
  // with the server, so feeding it a body it predates would break it.
  const change: import("../server/api-version.ts").VersionChange = { version: "2099-02-02", summary: "test", routes: [], downgrade: (b) => b };
  V.VERSION_CHANGES.push(change);
  try {
    resetApiGateCaches();
    const tenant = "pinned-dash";
    const { key } = await createApiKey(tenant, "ci", undefined, undefined, "editor");
    const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
    const { value } = await mintSession(await createUser("owner@pinned-dash.test", "a long and unusual passphrase 42!", tenant));
    await updateAdminState(tenant, { apiVersion: "2099-02-02" }, "test", "api-version");
    const viaKey = await apiGate(req("GET", "/api/workspaces", key));
    assert.equal(viaKey.headers["foldrun-version"], "2099-02-02", "a key gets the account's pin");
    const viaDashboard = await apiGate(new NextRequest("http://localhost:3900/api/workspaces", { headers: { cookie: `${SESSION_COOKIE}=${value}` } }));
    assert.equal(viaDashboard.refuse, undefined);
    assert.equal(viaDashboard.headers["foldrun-version"], V.CURRENT_API_VERSION, "a signed-in person gets the current version");
  } finally {
    V.VERSION_CHANGES.splice(V.VERSION_CHANGES.indexOf(change), 1);
  }
});

test("a registered change downgrades the body for callers pinned before it", async () => {
  const change: import("../server/api-version.ts").VersionChange = {
    version: "2099-01-01",
    summary: "runs: `cost` became `usd`",
    routes: [{ method: "GET", path: /^\/api\/workspaces\/[^/]+\/runs$/, file: "app/api/workspaces/[workspace]/runs/route.ts" }],
    downgrade: (b) => {
      const { usd, ...rest } = b as { usd: number };
      return { ...rest, cost: usd };
    },
  };
  const ctx = { method: "GET", path: "/api/workspaces/w/runs", status: 200 };
  assert.deepEqual(V.downgradeBody({ usd: 2 }, "2098-12-31", ctx, [change]), { cost: 2 });
  assert.deepEqual(V.downgradeBody({ usd: 2 }, "2099-01-01", ctx, [change]), { usd: 2 }, "pinned on or after: today's shape");
  assert.deepEqual(V.downgradeBody({ usd: 2 }, "2098-12-31", { ...ctx, path: "/api/keys" }, [change]), { usd: 2 }, "other routes untouched");

  const r = req("GET", "/api/workspaces/w/runs", undefined, { [V.RESOLVED_VERSION_HEADER]: "2098-12-31" });
  assert.deepEqual(await V.versionedJson(r, { usd: 3 }, {}, [change]).json(), { cost: 3 });
});

test("every route a version change names answers through versionedJson", () => {
  for (const c of V.VERSION_CHANGES) {
    for (const r of c.routes) {
      const src = fs.readFileSync(path.join(import.meta.dirname, "..", r.file), "utf8");
      assert.match(src, /versionedJson\(/, `${r.file} is named by the ${c.version} change but never calls versionedJson`);
    }
  }
  for (const v of V.releasedVersions()) assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
});

test("Deprecation and Sunset headers", () => {
  const h = V.deprecationHeaders({ deprecatedAt: "2026-10-01", sunsetAt: "2027-04-01", link: "https://docs.foldrun.io/api-usage" });
  assert.equal(h.deprecation, `@${Date.parse("2026-10-01") / 1000}`);
  assert.equal(h.sunset, "Thu, 01 Apr 2027 00:00:00 GMT");
  assert.match(h.link, /rel="deprecation"/);
  const list = [{ method: "GET", path: /^\/api\/old$/, route: "GET /api/old", deprecatedAt: "2026-10-01" }];
  assert.ok(V.deprecationFor("get", "/api/old", list));
  assert.equal(V.deprecationFor("GET", "/api/new", list), null);
});

test("the API changelog: every pinnable version newest first, what each broke, what is deprecated", () => {
  const change = { version: "2027-01-15", summary: "runs: finishedAt is endedAt", routes: [], downgrade: (b: unknown) => b };
  const dep = { method: "DELETE", path: /^\/api\/old$/, route: "DELETE /api/old", deprecatedAt: "2026-11-01", sunsetAt: "2027-05-01" };
  const log = V.apiChangelog([change], [dep]);
  assert.equal(log.current, V.CURRENT_API_VERSION);
  assert.equal(log.supportMonths, V.VERSION_SUPPORT_MONTHS);
  assert.deepEqual(log.versions[0], { version: "2027-01-15", changes: ["runs: finishedAt is endedAt"] });
  assert.ok(log.versions.some((v) => v.version === V.CURRENT_API_VERSION));
  assert.deepEqual(log.deprecations, [{ route: "DELETE /api/old", deprecatedAt: "2026-11-01", sunsetAt: "2027-05-01", link: null }]);
  // Today's list: the usage-ledger change on 2026-10-26, then the first
  // version, which stays pinnable (every CLI so far sends it).
  assert.deepEqual(V.apiChangelog().versions.map((v) => v.version), [V.CURRENT_API_VERSION, V.FIRST_API_VERSION]);
  assert.equal(V.apiChangelog().versions[0].changes.length, 1);
  assert.match(V.apiChangelog().versions[0].changes[0], /ledger\.providerCostUsd/);
  assert.deepEqual(V.apiChangelog().versions[1], { version: "2026-10-01", changes: [] });
});

// ---------------------------------------------------------------- openapi

test("the spec lists every route and method that exists, and nothing else", () => {
  const live = gen.walkRoutes() as { path: string; methods: string[] }[];
  const want = live.map((r) => `${gen.openapiPath(r.path)} ${r.methods.join(",")}`).sort();
  const have = ROUTES.map((r) => `${r.path} ${r.methods.join(",")}`).sort();
  const missing = want.filter((x) => !have.includes(x));
  // The list is generated where billing is present; without billing its
  // routes are absent, not phantom (and openapiDocument leaves them out).
  const phantom = have.filter((x) => !want.includes(x) && (billingPresent || !isBillingRoute(x)));
  assert.deepEqual(
    { missing, phantom },
    { missing: [], phantom: [] },
    "server/openapi-routes.ts is stale — run `node scripts/gen-openapi.mjs`",
  );
});

// The spec offers billing's routes when the PLATFORM has billing wired in
// (openapi.ts asks billing()); the route files are this repo's. A real build
// has both or neither. A checkout with one of them laid over and not the
// other (this web as committed beside a platform with foldrun-admin laid
// over it, as a pre-push worktree is) is not a build, and this check says so
// instead of failing on it.
const { billing, freeBilling } = await import("@/platform/billing");
const mixedEdition = billingPresent !== (billing() !== freeBilling) ? "web and platform are different editions here (one has foldrun-admin laid over it)" : false;

test("the spec offers exactly the operations this build serves — no billing route without billing", { skip: mixedEdition }, () => {
  const doc = openapiDocument("https://example.test") as { paths: Record<string, Record<string, unknown>> };
  const offered = Object.entries(doc.paths).flatMap(([p, item]) => Object.keys(item).map((m) => `${m.toUpperCase()} ${p}`)).sort();
  const served = (gen.walkRoutes() as { path: string; methods: string[] }[])
    .flatMap((r) => r.methods.filter((m) => m !== "HEAD").map((m) => `${m} ${gen.openapiPath(r.path)}`))
    .sort();
  assert.deepEqual(offered, served, "the document and the route files disagree");
  const billingOps = offered.filter((o) => isBillingRoute(o));
  if (billingPresent) assert.ok(billingOps.length > 10, "with billing, its routes are offered");
  else assert.deepEqual(billingOps, [], "without billing, no /api/billing or /api/admin operation is offered");
});

test("openapi.json is OpenAPI 3.1 with bearer auth, the common headers, and an operation per method", () => {
  const doc = openapiDocument("https://example.test") as {
    openapi: string;
    info: { version: string };
    security: unknown[];
    paths: Record<string, Record<string, { operationId: string; parameters: { $ref?: string }[]; security?: unknown[]; responses: Record<string, unknown> }>>;
    components: { securitySchemes: Record<string, { scheme: string }>; headers: Record<string, unknown> };
  };
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, V.CURRENT_API_VERSION);
  assert.equal(doc.components.securitySchemes.bearer.scheme, "bearer");
  for (const h of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Foldrun-Version"]) assert.ok(doc.components.headers[h], h);
  const ids = new Set<string>();
  for (const r of ROUTES.filter((x) => billingPresent || !isBillingRoute(x.path))) {
    for (const m of r.methods.filter((x) => x !== "HEAD")) {
      const op = doc.paths[r.path]?.[m.toLowerCase()];
      assert.ok(op, `${m} ${r.path} has an operation`);
      assert.ok(!ids.has(op.operationId), `operationId ${op.operationId} is unique`);
      ids.add(op.operationId);
      assert.ok(op.responses["429"], "every operation documents 429");
      const idem = op.parameters.some((p) => p.$ref?.endsWith("IdempotencyKey"));
      assert.equal(idem, (r.idempotent ?? []).includes(m), `${m} ${r.path}: Idempotency-Key documented exactly where honoured`);
    }
  }
  assert.deepEqual(doc.paths["/api/healthz"].get.security, [], "open routes need no key");
  assert.ok(doc.paths["/api/workspaces/{workspace}/deploy"].post, "deploy is there");
});
