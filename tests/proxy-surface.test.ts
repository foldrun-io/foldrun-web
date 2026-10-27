// The proxy by surface (27 Oct 2026): on the operator console's host only the
// console, its sign-in and health exist; on the customer app nothing changes.
//
//   node --import ./tests/register.mjs --test tests/proxy-surface.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-proxy-surface-"));
process.env.FOLDRUN_SECRET_KEY = "proxy-surface-key";
const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");

const at = async (surface: string | undefined, pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
  const prev = process.env.FOLDRUN_SURFACE;
  surface === undefined ? delete process.env.FOLDRUN_SURFACE : (process.env.FOLDRUN_SURFACE = surface);
  try {
    return await proxy(new NextRequest(`https://admin.example.test${pathname}`, { method: init.method ?? "GET", headers: init.headers }));
  } finally {
    prev === undefined ? delete process.env.FOLDRUN_SURFACE : (process.env.FOLDRUN_SURFACE = prev);
  }
};
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

test("on the console: the customer app, its API and signup are not here", async () => {
  for (const p of ["/dashboard", "/dashboard/acme", "/signup", "/s/abc", "/api/workspaces", "/api/billing", "/api/auth/signup"]) {
    assert.equal((await at("admin", p)).status, 404, p);
  }
});

test("on the console: the front door and a signed-out console page go to the console's sign-in", async () => {
  const root = await at("admin", "/");
  assert.equal(root.status, 307);
  assert.match(root.headers.get("location") ?? "", /\/login\?next=\/admin$/);
  const page = await at("admin", "/admin/customers");
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location") ?? "", /\/login\?next=%2Fadmin%2Fcustomers$/);
  const foreign = await at("admin", "/admin", { headers: { cookie: "foldrun_session=v1.x.9999999999999.forged" } });
  assert.equal(foreign.status, 307, "a token that is not a console session is a sign-in, not the console");
});

test("on the console: its sign-in page, sign-in API, health and console API are reached", async () => {
  assert.ok(passes(await at("admin", "/login?next=/admin")), "the sign-in page itself, not a redirect to itself");
  const bare = await at("admin", "/login");
  assert.equal(bare.status, 307, "a bare sign-in on the console lands on the console, not the dashboard");
  assert.match(bare.headers.get("location") ?? "", /\/login\?next=\/admin$/);
  assert.notEqual((await at("admin", "/api/healthz")).status, 404);
  const consoleApi = await at("admin", "/api/admin/runs");
  assert.notEqual(consoleApi.status, 404, "the console's API reaches its route, whose guard decides");
  const write = await at("admin", "/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(write.status, 403, "and the console's strict origin rule applies to its writes");
});

test("on the customer app: nothing new — pages it never touched pass, the dashboard still asks for a sign-in", async () => {
  assert.ok(passes(await at(undefined, "/admin")), "the console page decides for itself here, as before");
  assert.ok(passes(await at(undefined, "/login")));
  assert.ok(passes(await at(undefined, "/")));
  const dash = await at(undefined, "/dashboard");
  assert.equal(dash.status, 307);
  assert.match(dash.headers.get("location") ?? "", /\/(login|signup)\?next=%2Fdashboard$/);
});

test("a FOLDRUN_SURFACE typo serves nothing rather than guess", async () => {
  assert.equal((await at("amdin", "/dashboard")).status, 500);
});

test("every page carries the security headers, sign-in included; share links keep their own", async () => {
  for (const p of ["/login", "/signup", "/forgot", "/"]) {
    const r = await at(undefined, p);
    assert.equal(r.headers.get("x-frame-options"), "DENY", `${p} cannot be framed`);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin", p);
    assert.ok(r.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), p);
  }
  const share = await at(undefined, "/s/abc");
  assert.equal(share.headers.get("x-frame-options"), null, "a share link sets its own headers");
});

// 27 Oct 2026, from the API fuzz: a run stream for names the store refuses
// is a 404, not an uncaught 500.
test("a run stream for an impossible workspace or run name is a 404", async () => {
  const route = await import("../app/api/workspaces/[workspace]/runs/[runId]/stream/route.ts");
  const prev = process.env.FOLDRUN_DEV_NO_AUTH;
  process.env.FOLDRUN_DEV_NO_AUTH = "1";
  try {
    const r = await route.GET(new NextRequest("http://x/api/workspaces/x/runs/y/stream", { headers: { "x-foldrun-tenant": "acme" } }), {
      params: Promise.resolve({ workspace: "m:\u0007?\u007f", runId: "f\u001a\u0010Y " }),
    });
    assert.equal(r.status, 404);
  } finally {
    prev === undefined ? delete process.env.FOLDRUN_DEV_NO_AUTH : (process.env.FOLDRUN_DEV_NO_AUTH = prev);
  }
});
