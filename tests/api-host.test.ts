// The API host's route contract (server/api-host.ts): every route the
// platform has is on the API host or is the dashboard's with a reason, the
// rules do not rot, and the routes a person's browser alone may call are
// not served where only a bearer credential is read.
//
//   node --import ./tests/register.mjs --test tests/api-host.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROUTES } from "../server/openapi-routes.ts";
import { DASHBOARD_ONLY, apiHostServes, dashboardOnly } from "../server/api-host.ts";
import { billingPresent } from "./billing-files.ts";

// The public edition has no billing routes (they are foldrun-admin's): a
// rule or an expectation about one is checked only where they exist.
// The support view's routes (hosted, foldrun-admin) are never in the OpenAPI
// table, so its rule is checked against the overlay's folder instead.
const here = (p: string) => !p.startsWith("/v1/support") && (billingPresent || !p.startsWith("/v1/billing"));

const paths = [...new Set(ROUTES.map((r) => r.path))];

test("every route is the API host's or the dashboard's, never neither", () => {
  for (const p of paths) {
    // A page's own address (a share link, /s/<token>) is not the API at all.
    if (!p.startsWith("/v1/")) assert.equal(apiHostServes(p), false, p);
    else assert.equal(apiHostServes(p), dashboardOnly(p) === null, p);
  }
});

test("each dashboard-only rule still names a real route, and says why", () => {
  for (const [prefix, reason, methods] of DASHBOARD_ONLY) {
    if (!here(prefix)) continue;
    const routes = ROUTES.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`));
    assert.ok(routes.length > 0, `no route under ${prefix}: the rule is stale`);
    for (const m of methods ?? []) assert.ok(routes.some((r) => r.methods.includes(m)), `no ${m} under ${prefix}: the rule is stale`);
    assert.ok(reason.length > 20, `${prefix} needs a reason a reviewer can check`);
  }
});

test("a rule is a whole path segment, not a string prefix", () => {
  assert.equal(apiHostServes("/v1/authorize-something"), true);
  assert.equal(apiHostServes("/v1/auth"), false);
  assert.equal(apiHostServes("/v1/auth/mfa/setup"), false);
  assert.equal(apiHostServes("/v1"), false);
  assert.equal(apiHostServes("/dashboard"), false);
});

test("what a program calls is on the API host", () => {
  for (const p of [
    "/v1/workspaces",
    "/v1/keys",
    "/v1/secrets",
    "/v1/schedule",
    "/v1/account/usage",
    "/v1/mcp",
    "/v1/mcp/oauth/token",
    "/v1/mcp/oauth/register",
    "/v1/mcp/oauth/revoke",
    "/v1/cli/login",
    "/v1/oauth/device",
    "/v1/team",
    // The CLI's billing calls, made with a key (Codex review, 21 Nov 2026).
    "/v1/billing",
    "/v1/billing/checkout",
    "/v1/billing/card",
    "/v1/billing/portal",
    "/v1/billing/subscribe",
    "/v1/healthz",
    "/v1/version",
    "/v1/openapi.json",
  ].filter(here)) {
    assert.ok(paths.includes(p), `${p} is not a route any more: update this list`);
    assert.equal(apiHostServes(p), true, p);
  }
});

test("a browser's sign-in, approve pages and card forms are not", () => {
  for (const p of ["/v1/auth/login", "/v1/auth/session", "/v1/auth/mfa/verify", "/v1/cli/authorize", "/v1/mcp/oauth/authorize", "/v1/oauth/callback", "/v1/team/transfer", "/v1/account/close", "/v1/billing/confirm", "/v1/metrics"].filter(here)) {
    assert.ok(paths.includes(p), `${p} is not a route any more: update this list`);
    assert.equal(apiHostServes(p), false, p);
  }
});

test("most of the platform API is on the API host", () => {
  const served = paths.filter((p) => apiHostServes(p)).length;
  assert.ok(served / paths.length > 0.7, `${served} of ${paths.length}`);
});

test("a rule may keep one method off and serve the rest", () => {
  assert.equal(apiHostServes("/v1/me/onboarding"), true);
  assert.equal(apiHostServes("/v1/me/onboarding", "GET"), true);
  assert.equal(apiHostServes("/v1/me/onboarding", "PATCH"), false);
  assert.equal(apiHostServes("/v1/me/onboarding", "patch"), false);
  assert.equal(apiHostServes("/v1/auth/login", "POST"), false);
  assert.equal(apiHostServes("/v1/workspaces", "DELETE"), true);
});

test("the support rule names the hosted support routes, where the overlay lays them", () => {
  assert.ok(DASHBOARD_ONLY.some(([p]) => p === "/v1/support"));
  if (billingPresent) assert.ok(fs.existsSync(path.join(import.meta.dirname, "..", "app", "v1", "support")), "app/v1/support is laid by foldrun-admin");
});
