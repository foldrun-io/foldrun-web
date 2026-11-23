// The platform API under /v1 (23 Nov 2026, server/v1-path.ts): every /api
// route a program may call answers at /v1 too, through the same checks;
// the gateway's names and the dashboard's routes never do.
//
//   node --import ./tests/register.mjs --test tests/v1-path.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-v1-path-"));
process.env.FOLDRUN_SECRET_KEY = "v1-path-key";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_DATABASE_URL;

const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");
const { v1Target, v1PathOf, V1_MODEL_ROUTES } = await import("../server/v1-path.ts");
const { DASHBOARD_ONLY } = await import("../server/api-host.ts");
const { ROUTES } = await import("../server/openapi-routes.ts");

test("a /v1 path is its /api twin; the account's usage is renamed", () => {
  assert.deepEqual(v1Target("/v1/workspaces/acme/runs"), { api: "/api/workspaces/acme/runs" });
  assert.deepEqual(v1Target("/v1/keys"), { api: "/api/keys" });
  assert.deepEqual(v1Target("/v1/version"), { api: "/api/version" });
  assert.deepEqual(v1Target("/v1/account/usage"), { api: "/api/usage" });
  assert.deepEqual(v1Target("/v1/account/usage/budget"), { api: "/api/usage/budget" });
  assert.deepEqual(v1Target("/v1/account/api"), { api: "/api/account/api" }, "the rename takes account/usage only");
  assert.equal(v1Target("/api/keys"), null, "not under /v1");
  assert.equal(v1Target("/v1x/keys"), null, "/v1x is not /v1");
});

test("the gateway's names are never the platform's", () => {
  for (const p of [...V1_MODEL_ROUTES, "/v1/usage/budget", "/v1/models/claude-x", "/v1/foldrun/other"]) {
    const t = v1Target(p);
    assert.ok(t && "refuse" in t, `${p} is the gateway's`);
  }
  assert.match((v1Target("/v1/usage/history") as { refuse: string }).refuse, /\/v1\/account\/usage/, "pointed at the platform's name");
  assert.ok("refuse" in (v1Target("/v1") as object) && "refuse" in (v1Target("/v1/") as object));
});

test("the dashboard's routes are not under /v1, a key's methods of a mixed one are", () => {
  for (const [prefix, , methods] of DASHBOARD_ONLY) {
    const v1 = `/v1${prefix.slice("/api".length)}`;
    if (methods) {
      for (const m of methods) assert.ok("refuse" in (v1Target(v1, m) as object), `${m} ${v1} stays the dashboard's`);
      assert.deepEqual(v1Target(v1, "GET"), { api: prefix }, `GET ${v1} is a key's`);
    } else {
      assert.ok("refuse" in (v1Target(v1, "GET") as object), `${v1} stays the dashboard's`);
      assert.ok("refuse" in (v1Target(`${v1}/x`, "POST") as object), `under ${v1} too`);
    }
  }
});

test("every documented route a program may call has a /v1 name that maps back to it", () => {
  let n = 0;
  for (const r of ROUTES) {
    for (const m of r.methods) {
      const v1 = v1PathOf(r.path, m);
      if (v1 === null) continue;
      n++;
      assert.deepEqual(v1Target(v1, m), { api: r.path }, `${m} ${r.path} ↔ ${v1}`);
      assert.ok(!V1_MODEL_ROUTES.includes(v1), `${r.path} would land on the gateway's ${v1}`);
    }
  }
  assert.ok(n > 150, `the platform's routes are there (${n})`);
  assert.equal(v1PathOf("/api/usage"), "/v1/account/usage");
  assert.equal(v1PathOf("/api/auth/login", "POST"), null);
});

const call = (host: string, pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`https://${host}${pathname}`, { method: init.method ?? "GET", headers: init.headers }));

test("a /v1 path that reaches the app unmapped is refused, on any host, before any handler", async () => {
  for (const host of ["dash.example.test", "api.example.test"]) {
    for (const p of ["/v1/keys", "/v1/workspaces/acme/runs", "/v1/account/usage", "/v1", "/v1/"]) {
      const browser = await call(host, p, { headers: { cookie: "foldrun_session=x" } });
      assert.equal(browser.status, 404, `${host}${p} with a session`);
      assert.equal(browser.headers.get("x-middleware-next"), null);
      const r = await call(host, p, { headers: { "foldrun-version": "2026-11-22", authorization: "Bearer fr_api_test" } });
      assert.equal(r.status, 404, `${host}${p}`);
      assert.equal(r.headers.get("x-middleware-next"), null, `${host}${p} reaches no handler`);
      assert.equal(r.headers.get("x-middleware-rewrite"), null, `${host}${p} is rewritten nowhere`);
      const body = await r.json();
      assert.equal(body.type, "error", "Anthropic's body from 2026-11-22");
      assert.match(body.error.message, /urls\.api/);
    }
  }
  const legacy = await (await call("dash.example.test", "/v1/keys", { headers: { "foldrun-version": "2026-10-01", authorization: "Bearer fr_api_test" } })).json();
  assert.equal(typeof legacy.error, "string", "an older pin gets the old body");
});

test("/api and the pages are unchanged; /v1x is not /v1", async () => {
  const api = await call("dash.example.test", "/api/version");
  assert.equal(api.headers.get("x-middleware-next"), "1");
  assert.ok(api.headers.get("x-foldrun-api"));
  const other = await call("dash.example.test", "/v1x");
  assert.notEqual(other.status, 404, "not the /v1 refusal");
});
