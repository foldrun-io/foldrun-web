// The Origin check behind SameSite: a cookie-carrying write from another
// site is refused; everything that is not that passes.
//
//   node --import ./tests/register.mjs --test tests/csrf.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteWrite } from "../server/csrf.ts";

const req = (method: string, headers: Record<string, string>) => ({ method, headers: new Headers(headers) });
const withCookie = { cookie: "foldrun_session=v2.abc.123.def", host: "app.foldrun.io" };

test("a write with our cookie from another origin is refused, naming the origin", () => {
  const why = crossSiteWrite(req("POST", { ...withCookie, origin: "https://evil.example" }), undefined);
  assert.match(why ?? "", /evil\.example/);
  assert.ok(crossSiteWrite(req("DELETE", { ...withCookie, origin: "https://app.foldrun.io.evil.example" }), undefined));
  assert.ok(crossSiteWrite(req("POST", { ...withCookie, origin: "null" }), undefined), "an opaque origin is nobody's");
});

test("the install's own origin passes: the request host, or FOLDRUN_PUBLIC_URL", () => {
  assert.equal(crossSiteWrite(req("POST", { ...withCookie, origin: "https://app.foldrun.io" }), undefined), null);
  assert.equal(crossSiteWrite(req("POST", { ...withCookie, origin: "https://APP.foldrun.io" }), undefined), null, "hosts compare case-blind");
  // Behind a proxy the request host is internal; x-forwarded-host is what the browser saw.
  assert.equal(crossSiteWrite(req("PATCH", { cookie: withCookie.cookie, host: "10.42.0.7:3000", "x-forwarded-host": "app.foldrun.io", origin: "https://app.foldrun.io" }), undefined), null);
  assert.equal(crossSiteWrite(req("PUT", { cookie: withCookie.cookie, host: "10.42.0.7:3000", origin: "https://dev.foldrun.io" }), "https://dev.foldrun.io/"), null);
  assert.ok(crossSiteWrite(req("PUT", { cookie: withCookie.cookie, host: "10.42.0.7:3000", origin: "https://dev.foldrun.io" }), "https://app.foldrun.io"));
});

test("what it leaves alone: reads, Bearer requests, requests with no Origin, requests with no cookie", () => {
  assert.equal(crossSiteWrite(req("GET", { ...withCookie, origin: "https://evil.example" }), undefined), null);
  assert.equal(crossSiteWrite(req("POST", { ...withCookie, origin: "https://evil.example", authorization: "Bearer mda_abc" }), undefined), null, "the CLI is not a browser");
  assert.equal(crossSiteWrite(req("POST", withCookie), undefined), null, "no Origin: SameSite is the layer");
  assert.equal(crossSiteWrite(req("POST", { host: "app.foldrun.io", origin: "https://evil.example" }), undefined), null, "no cookie, nothing to forge");
  assert.equal(crossSiteWrite(req("POST", { host: "app.foldrun.io", cookie: "other=1; notfoldrun_session=x", origin: "https://evil.example" }), undefined), null);
});


test("sign-in routes check Origin even without a session cookie (login CSRF)", () => {
  const at = (path: string, headers: Record<string, string>) => ({ method: "POST", headers: new Headers(headers), url: `https://app.foldrun.io${path}` });
  const evil = { host: "app.foldrun.io", origin: "https://evil.example" };
  for (const p of ["/api/auth/login", "/api/auth/signup", "/api/auth/reset", "/api/auth/mfa/verify"]) {
    assert.ok(crossSiteWrite(at(p, evil), undefined), p);
    assert.equal(crossSiteWrite(at(p, { host: "app.foldrun.io", origin: "https://app.foldrun.io" }), undefined), null, `${p} from ourselves`);
    assert.equal(crossSiteWrite(at(p, { host: "app.foldrun.io" }), undefined), null, `${p} with no Origin (curl, the CLI)`);
  }
  assert.equal(crossSiteWrite(at("/api/auth/forgot", evil), undefined), null, "other routes still need the cookie to be forgeable");
});
