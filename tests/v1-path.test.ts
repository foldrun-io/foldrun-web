// One URL format (owner, 23 Nov 2026): every route of this app is under
// /v1, and none takes a name the API host's gateway answers
// (server/v1-path.ts). There is no /api.
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
const { V1_MODEL_ROUTES, V1_GATEWAY_PREFIXES } = await import("../server/v1-path.ts");
const { ROUTES } = await import("../server/openapi-routes.ts");

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

test("every route is under /v1 (or the share link), and app/api is gone", () => {
  assert.ok(ROUTES.length > 150, `the routes are there (${ROUTES.length})`);
  for (const r of ROUTES) assert.ok(r.path.startsWith("/v1/") || r.path.startsWith("/s/"), r.path);
  assert.ok(!fs.existsSync(path.join(import.meta.dirname, "..", "app", "api")), "no app/api folder");
});

test("no route takes a name the gateway answers on the API host", () => {
  for (const r of ROUTES) {
    assert.ok(!V1_MODEL_ROUTES.includes(r.path), `${r.path} is the gateway's`);
    assert.ok(!V1_GATEWAY_PREFIXES.some((p) => under(r.path, p)), `${r.path} is under the gateway's ${V1_GATEWAY_PREFIXES.find((p) => under(r.path, p))}`);
  }
  assert.ok(ROUTES.some((r) => r.path === "/v1/account/usage"), "the account's usage is /v1/account/usage");
});

const call = (host: string, pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`https://${host}${pathname}`, { method: init.method ?? "GET", headers: init.headers }));

test("/v1 goes through the API's checks on any host; /api and /v1x are not the API", async () => {
  for (const host of ["dash.example.test", "api.example.test"]) {
    const r = await call(host, "/v1/version");
    assert.equal(r.headers.get("x-middleware-next"), "1", `${host}/v1/version reaches its route`);
    assert.ok(r.headers.get("x-foldrun-api"), `${host}/v1/version carries the API headers`);
    const bad = await call(host, "/v1/keys%2F..");
    assert.equal(bad.status, 400, "the raw-path guard holds on /v1");
  }
  for (const p of ["/api/version", "/v1x"]) {
    const r = await call("dash.example.test", p);
    assert.equal(r.headers.get("x-foldrun-api"), null, `${p} is not the API`);
  }
});
