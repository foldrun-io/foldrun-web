// One API, Anthropic's shape (owner, 22 Nov 2026): from API version
// 2026-11-22 an /api refusal is the body /v1 answers with, and /api takes
// the key as x-api-key as well as Authorization: Bearer. Older pins and a
// signed-in browser keep { error: "…" }.
//
//   node --import ./tests/register.mjs --test tests/one-api-errors.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-one-api-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const V = await import("../server/api-version.ts");
const S = await import("../server/error-shape.ts");
const { refuse, refuseWith, ApiError, errorResponse } = await import("../server/api.ts");
const { apiGate, resetApiGateCaches } = await import("../server/api-limits.ts");
const { createApiKey } = await import("../server/auth.ts");
const { proxy } = await import("../proxy.ts");

test("Anthropic's error types by status", () => {
  const cases: [number, string][] = [
    [400, "invalid_request_error"], [409, "invalid_request_error"], [422, "invalid_request_error"],
    [401, "authentication_error"], [402, "billing_error"], [403, "permission_error"], [404, "not_found_error"],
    [413, "request_too_large"], [429, "rate_limit_error"], [500, "api_error"], [502, "api_error"], [503, "overloaded_error"], [529, "overloaded_error"],
  ];
  for (const [status, type] of cases) assert.equal(S.errorTypeFor(status), type, String(status));
});

test("the two bodies, and the downgrade between them", () => {
  assert.deepEqual(S.errorBody("no such run", 404, { code: "not_found" }, "anthropic"), { type: "error", error: { type: "not_found_error", message: "no such run", code: "not_found" } });
  assert.deepEqual(S.errorBody("no such run", 404, { code: "not_found" }, "legacy"), { error: "no such run", code: "not_found" });
  const now = S.errorBody("busy", 409, { runId: "r1" }, "anthropic");
  assert.deepEqual(S.legacyErrorBody(now), { error: "busy", runId: "r1" });
  const change = V.VERSION_CHANGES.find((c) => c.version === V.ERROR_SHAPE_VERSION)!;
  assert.deepEqual(change.downgrade(now, { method: "GET", path: "/api/x", status: 409 }), { error: "busy", runId: "r1" });
  assert.equal(V.CURRENT_API_VERSION, V.ERROR_SHAPE_VERSION, "the change is the current version");
});

test("refuse, refuseWith and errorResponse answer in the request's shape; nothing said is the old body", async () => {
  assert.deepEqual(await refuse("nope", 403).json(), { error: "nope" });
  await S.withErrorShape("anthropic", async () => {
    assert.deepEqual(await refuse("nope", 403).json(), { type: "error", error: { type: "permission_error", message: "nope" } });
    assert.deepEqual(await refuseWith("busy", 409, { runId: "r9" }).json(), { type: "error", error: { type: "invalid_request_error", message: "busy", runId: "r9" } });
    const res = errorResponse(new ApiError("gone", 404));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { type: "error", error: { type: "not_found_error", message: "gone" } });
  });
});

const req = (headers: Record<string, string> = {}, p = "/api/workspaces") => new NextRequest(`http://localhost${p}`, { headers });

test("the gate: a key on the current version gets Anthropic's body; an older pin, and a signed-in browser, the old one", async () => {
  resetApiGateCaches();
  const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
  const now = await apiGate(req({ authorization: `Bearer ${key}` }));
  assert.equal(now.requestHeaders[V.ERROR_SHAPE_HEADER], "anthropic");
  const pinned = await apiGate(req({ authorization: `Bearer ${key}`, "foldrun-version": "2026-10-26" }));
  assert.equal(pinned.requestHeaders[V.ERROR_SHAPE_HEADER], "legacy");
  const browser = await apiGate(req({ cookie: "foldrun_session=not-a-real-one" }));
  assert.equal(browser.requestHeaders[V.ERROR_SHAPE_HEADER], "legacy");
  const bad = await apiGate(req({ authorization: `Bearer ${key}`, "foldrun-version": "2026-13-99" }));
  assert.equal(bad.refuse?.status, 400);
  assert.equal(((await bad.refuse!.json()) as { type: string }).type, "error");
});

test("the proxy: x-api-key is the same key as a Bearer; two different keys are refused; a caller cannot set the shape", async () => {
  const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
  const one = await proxy(req({ "x-api-key": "fr_api_example" }));
  assert.equal(forwarded(one, "authorization"), "Bearer fr_api_example");
  assert.equal(forwarded(one, "x-api-key"), null);
  const same = await proxy(req({ "x-api-key": "fr_api_example", authorization: "Bearer fr_api_example" }));
  assert.notEqual(same.status, 400);
  const two = await proxy(req({ "x-api-key": "fr_api_one", authorization: "Bearer fr_api_two" }));
  assert.equal(two.status, 400);
  assert.deepEqual(await two.json(), { type: "error", error: { type: "invalid_request_error", message: "send the key once — x-api-key or Authorization: Bearer, not two different ones" } });
  const spoof = await proxy(req({ [V.ERROR_SHAPE_HEADER]: "anthropic", cookie: "foldrun_session=x" }));
  assert.notEqual(forwarded(spoof, V.ERROR_SHAPE_HEADER), "anthropic", "the gate's word, never the caller's");
});

test("an account pinned before 2026-11-22 gets the old body from the proxy's own refusals too, header or not", async () => {
  const { updateAdminState } = await import("@/platform/admin");
  const { forgetAccountProfile } = await import("../server/api-limits.ts");
  const { key } = await createApiKey("pinned-old", "ci", "ci@pinned.test", undefined, "admin", null);
  await updateAdminState("pinned-old", { apiVersion: "2026-10-26" }, "test", "api-version");
  forgetAccountProfile("pinned-old");
  const big = new NextRequest("http://localhost/api/workspaces/w/source", { method: "PUT", headers: { "x-api-key": key, "content-type": "application/json", "content-length": String(64 * 1024 * 1024) } });
  const r = await proxy(big);
  assert.equal(r.status, 413);
  const body = (await r.json()) as { error: unknown };
  assert.equal(typeof body.error, "string", "the account's pin, not current");
  const { key: now } = await createApiKey("acme", "ci2", "ci@acme.test", undefined, "admin", null);
  const r2 = await proxy(new NextRequest("http://localhost/api/workspaces/w/source", { method: "PUT", headers: { "x-api-key": now, "content-type": "application/json", "content-length": String(64 * 1024 * 1024) } }));
  assert.equal(((await r2.json()) as { type: string }).type, "error");
});

test("an idempotent replay answers in the shape the retry asked for, never the first one's", async () => {
  const { replayedBody } = await import("../server/idempotency.ts");
  const old = JSON.stringify({ error: "did not check out", issues: [1] });
  const fresh = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "did not check out", issues: [1] } });
  await S.withErrorShape("anthropic", async () => {
    assert.deepEqual(JSON.parse(replayedBody(old, 422, "application/json")), JSON.parse(fresh));
    assert.equal(replayedBody(fresh, 422, "application/json"), fresh);
    assert.equal(replayedBody('{"ok":true}', 200, "application/json"), '{"ok":true}', "a success is replayed byte for byte");
    const before = JSON.stringify({ ok: false, reason: "did not check out", issues: [], blockedBy: [] });
    const now = JSON.parse(replayedBody(before, 422, "application/json")) as { type: string; error: { message: string; blockedBy: unknown[] } };
    assert.equal(now.type, "error");
    assert.equal(now.error.message, "did not check out", "a deploy refusal stored before the change");
    assert.deepEqual(now.error.blockedBy, []);
  });
  await S.withErrorShape("legacy", async () => {
    assert.deepEqual(JSON.parse(replayedBody(fresh, 422, "application/json")), JSON.parse(old));
    assert.equal(replayedBody("not json", 400, "text/plain"), "not json");
  });
});

test("MCP's in-process tool calls read a refusal's sentence and findings from either body", () => {
  const anthropic = { type: "error", error: { type: "invalid_request_error", message: "2 problems", issues: [{ rule: "a" }, { rule: "b" }] } };
  assert.deepEqual(S.legacyErrorBody(anthropic), { error: "2 problems", issues: [{ rule: "a" }, { rule: "b" }] });
  assert.deepEqual(S.legacyErrorBody({ error: "x", issues: [] }), { error: "x", issues: [] }, "the old body passes through");
});
