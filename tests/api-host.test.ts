// The API host's route contract (server/api-host.ts): every route the
// platform has is on the API host or is the dashboard's with a reason, the
// rules do not rot, and the routes a person's browser alone may call are
// not served where only a bearer credential is read.
//
//   node --import ./tests/register.mjs --test tests/api-host.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { ROUTES } from "../server/openapi-routes.ts";
import { DASHBOARD_ONLY, apiHostServes, dashboardOnly } from "../server/api-host.ts";
import { billingPresent } from "./billing-files.ts";

// The public edition has no billing routes (they are foldrun-admin's): a
// rule or an expectation about one is checked only where they exist.
const here = (p: string) => billingPresent || !p.startsWith("/api/billing");

const paths = [...new Set(ROUTES.map((r) => r.path))];

test("every route is the API host's or the dashboard's, never neither", () => {
  for (const p of paths) {
    // A page's own address (a share link, /s/<token>) is not the API at all.
    if (!p.startsWith("/api/")) assert.equal(apiHostServes(p), false, p);
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
  assert.equal(apiHostServes("/api/authorize-something"), true);
  assert.equal(apiHostServes("/api/auth"), false);
  assert.equal(apiHostServes("/api/auth/mfa/setup"), false);
  assert.equal(apiHostServes("/api"), false);
  assert.equal(apiHostServes("/dashboard"), false);
});

test("what a program calls is on the API host", () => {
  for (const p of [
    "/api/workspaces",
    "/api/keys",
    "/api/secrets",
    "/api/schedule",
    "/api/usage",
    "/api/mcp",
    "/api/mcp/oauth/token",
    "/api/mcp/oauth/register",
    "/api/mcp/oauth/revoke",
    "/api/cli/login",
    "/api/oauth/device",
    "/api/team",
    // The CLI's billing calls, made with a key (Codex review, 21 Nov 2026).
    "/api/billing",
    "/api/billing/checkout",
    "/api/billing/card",
    "/api/billing/portal",
    "/api/billing/subscribe",
    "/api/healthz",
    "/api/version",
    "/api/openapi.json",
  ].filter(here)) {
    assert.ok(paths.includes(p), `${p} is not a route any more: update this list`);
    assert.equal(apiHostServes(p), true, p);
  }
});

test("a browser's sign-in, approve pages and card forms are not", () => {
  for (const p of ["/api/auth/login", "/api/auth/session", "/api/auth/mfa/verify", "/api/cli/authorize", "/api/mcp/oauth/authorize", "/api/oauth/callback", "/api/team/transfer", "/api/account/close", "/api/billing/confirm", "/api/metrics"].filter(here)) {
    assert.ok(paths.includes(p), `${p} is not a route any more: update this list`);
    assert.equal(apiHostServes(p), false, p);
  }
});

test("most of the platform API is on the API host", () => {
  const served = paths.filter((p) => apiHostServes(p)).length;
  assert.ok(served / paths.length > 0.7, `${served} of ${paths.length}`);
});

test("a rule may keep one method off and serve the rest", () => {
  assert.equal(apiHostServes("/api/me/onboarding"), true);
  assert.equal(apiHostServes("/api/me/onboarding", "GET"), true);
  assert.equal(apiHostServes("/api/me/onboarding", "PATCH"), false);
  assert.equal(apiHostServes("/api/me/onboarding", "patch"), false);
  assert.equal(apiHostServes("/api/auth/login", "POST"), false);
  assert.equal(apiHostServes("/api/workspaces", "DELETE"), true);
});
