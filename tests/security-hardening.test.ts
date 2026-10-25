// Two hardening fences:
//   1. the boot-time refusal of FOLDRUN_DEV_NO_AUTH where it would be a hole,
//   2. the baseline security headers the proxy puts on every page and API
//      response (except the routes that harden their own bytes).

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { devAuthStartupError, devAuthEnabled } from "../server/dev-auth-guard.ts";
import { proxy } from "../proxy.ts";

// ── 1. FOLDRUN_DEV_NO_AUTH boot guard ────────────────────────────────────────

test("dev-auth guard refuses production with the bypass on", () => {
  const err = devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "1", NODE_ENV: "production" });
  assert.ok(err, "a production boot with the bypass must be refused");
  assert.match(err!, /NODE_ENV=production/);
});

test("dev-auth guard refuses a non-loopback public URL with the bypass on", () => {
  const err = devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "1", FOLDRUN_PUBLIC_URL: "https://dev.foldrun.io" });
  assert.ok(err, "a public URL on the internet with the bypass must be refused");
  assert.match(err!, /dev\.foldrun\.io/);
});

test("dev-auth guard refuses an unparseable public URL with the bypass on", () => {
  const err = devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "1", FOLDRUN_PUBLIC_URL: "not a url" });
  assert.ok(err, "an unparseable public URL is refused rather than assumed safe");
});

test("dev-auth guard allows a loopback laptop with the bypass on", () => {
  for (const url of ["http://localhost:3900", "http://127.0.0.1:3900", "http://[::1]:3900"]) {
    assert.equal(devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "1", FOLDRUN_PUBLIC_URL: url }), null, url);
  }
  // No public URL and not production is a plain laptop — allowed.
  assert.equal(devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "1" }), null);
});

test("dev-auth guard does nothing when the bypass is off, even in production", () => {
  assert.equal(devAuthEnabled({ FOLDRUN_DEV_NO_AUTH: "0" }), false);
  assert.equal(devAuthStartupError({ FOLDRUN_DEV_NO_AUTH: "0", NODE_ENV: "production", FOLDRUN_PUBLIC_URL: "https://dev.foldrun.io" }), null);
  assert.equal(devAuthStartupError({ NODE_ENV: "production" }), null);
});

// ── 2. baseline security headers from the proxy ──────────────────────────────

const BASELINE = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function assertBaseline(res: { headers: Headers }, where: string) {
  for (const [k, v] of Object.entries(BASELINE)) assert.equal(res.headers.get(k), v, `${where}: ${k}`);
  const csp = res.headers.get("content-security-policy-report-only");
  assert.ok(csp, `${where}: CSP-Report-Only present`);
  assert.match(csp!, /frame-ancestors 'none'/, `${where}: CSP frame-ancestors`);
  assert.match(csp!, /default-src 'self'/, `${where}: CSP default-src self`);
  assert.match(csp!, /nonce-[0-9a-f]+/, `${where}: CSP carries a nonce`);
}

test("an API response carries the baseline headers and HSTS over https", async () => {
  const res = await proxy(new NextRequest("https://app.foldrun.io/api/version"));
  assertBaseline(res, "GET /api/version");
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000");
});

test("a dashboard page response (the login redirect) carries the baseline headers", async () => {
  // No session, no dev bypass: the proxy redirects, and the redirect is still
  // a page response that must be hardened.
  const res = await proxy(new NextRequest("https://app.foldrun.io/dashboard"));
  assert.ok([302, 307, 308].includes(res.status), `expected a redirect, got ${res.status}`);
  assertBaseline(res, "GET /dashboard");
});

test("HSTS is withheld over plain http", async () => {
  const res = await proxy(new NextRequest("http://localhost:3900/api/version"));
  assert.equal(res.headers.get("strict-transport-security"), null, "no HSTS without TLS");
  assert.equal(res.headers.get("x-frame-options"), "DENY", "the rest of the floor still applies");
});

test("a route that hardens its own bytes is left untouched by the blanket policy", async () => {
  const res = await proxy(new NextRequest("https://app.foldrun.io/api/avatars/user/abc"));
  assert.equal(res.headers.get("x-frame-options"), null, "self-hardened route keeps its own headers, not the blanket set");
  assert.equal(res.headers.get("content-security-policy-report-only"), null);
});
