// The proxy on the pages it does not guard: they pass with the security
// headers, the dashboard asks for a sign-in, share links keep their own.
//
//   node --import ./tests/register.mjs --test tests/proxy-pages.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-proxy-pages-"));
process.env.FOLDRUN_SECRET_KEY = "proxy-pages-key";
const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");

const at = (_unused: undefined, pathname: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`https://app.example.test${pathname}`, { method: init.method ?? "GET", headers: init.headers }));
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

test("pages it never touched pass, the dashboard still asks for a sign-in", async () => {
  assert.ok(passes(await at(undefined, "/admin")), "a page this app may not have is its own to answer");
  assert.ok(passes(await at(undefined, "/login")));
  assert.ok(passes(await at(undefined, "/")));
  const dash = await at(undefined, "/dashboard");
  assert.equal(dash.status, 307);
  assert.match(dash.headers.get("location") ?? "", /\/(login|signup)\?next=%2Fdashboard$/);
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
