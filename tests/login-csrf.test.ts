// FOL-103, login CSRF. The cross-site check ran only for a request that
// already carried our session cookie, and the sign-in routes read their body
// with req.json() whatever its type — so a page on another site could post an
// enctype=text/plain form whose body is valid JSON and sign a signed-out
// visitor into the attacker's account. Now every write that needs no
// credential (and the CLI-approve one) is checked by Origin — or, where a
// browser sends none, Sec-Fetch-Site — cookie or not, and takes JSON only.
// What is not a browser (no Origin, no Sec-Fetch-Site: the CLI, curl) passes.
//
//   node --import ./tests/register.mjs --test tests/login-csrf.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-login-csrf-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_SECRET_KEY = "login-csrf-install-key";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_PUBLIC_URL;
delete process.env.FOLDRUN_SETUP_TOKEN;

const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");
const login = await import("../app/api/auth/login/route.ts");
const cliLogin = await import("../app/api/cli/login/route.ts");
const { createUser } = await import("../server/users.ts");

const HOST = "app.foldrun.test";
const ORIGIN = `https://${HOST}`;
const ROUTES = ["/api/auth/login", "/api/auth/signup", "/api/auth/reset", "/api/auth/forgot", "/api/auth/mfa/verify", "/api/cli/login", "/api/cli/authorize"];
const CREDS = JSON.stringify({ email: "attacker@example.test", password: "Correct-horse-battery-9", x: "=" });

const request = (p: string, headers: Record<string, string>, body = CREDS) =>
  new NextRequest(`${ORIGIN}${p}`, { method: "POST", headers: { host: HOST, ...headers }, body });

/** What the proxy did: refused (with its status), or let the request on. */
async function throughProxy(p: string, headers: Record<string, string>, body?: string) {
  const res = await proxy(request(p, headers, body));
  return { status: res.status, passed: res.headers.get("x-middleware-next") === "1" || res.headers.has("x-middleware-rewrite"), error: res.status >= 400 ? ((await res.json()) as { error: string }).error : null };
}

test("every open write: a cross-site text/plain or urlencoded form post is refused, with or without Origin", async () => {
  for (const p of ROUTES) {
    // What an <form enctype="text/plain"> on evil.example sends: Origin, and Sec-Fetch-Site.
    const plain = await throughProxy(p, { "content-type": "text/plain", origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    assert.equal(plain.status, 403, `${p} text/plain`);
    assert.match(plain.error ?? "", /evil\.example/);
    const form = await throughProxy(p, { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, "email=a%40b.c&password=x");
    assert.equal(form.status, 403, `${p} urlencoded`);
    // A browser that sends no Origin still says where it came from.
    const noOrigin = await throughProxy(p, { "content-type": "text/plain", "sec-fetch-site": "cross-site" });
    assert.equal(noOrigin.status, 403, `${p} no Origin, Sec-Fetch-Site: cross-site`);
    assert.equal((await throughProxy(p, { "content-type": "application/json", "sec-fetch-site": "same-site" })).status, 403, `${p} a sibling subdomain is another site`);
    // An opaque origin (sandboxed frame, data: page) is nobody's.
    assert.equal((await throughProxy(p, { "content-type": "application/json", origin: "null" })).status, 403, `${p} Origin: null`);
    // Even same-origin, a body that is not JSON is not taken (415): no form can send JSON.
    assert.equal((await throughProxy(p, { "content-type": "text/plain", origin: ORIGIN, "sec-fetch-site": "same-origin" })).status, 415, `${p} same-origin text/plain`);
    assert.equal((await throughProxy(p, { "content-type": "multipart/form-data; boundary=x", origin: ORIGIN })).status, 415, `${p} multipart`);
    assert.equal((await throughProxy(p, {}, CREDS)).status, 415, `${p} no content-type at all`);
    // Our own page's fetch: same origin, JSON — on to the route.
    const ours = await throughProxy(p, { "content-type": "application/json; charset=utf-8", origin: ORIGIN, "sec-fetch-site": "same-origin" });
    assert.equal(ours.passed, true, `${p} same-origin JSON passes (${ours.status} ${ours.error})`);
  }
});

test("same-origin JSON signs in, end to end: through the proxy, then the route sets the session", async () => {
  await createUser("owner@example.test", "Correct-horse-battery-9", "acme");
  const headers = { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin" };
  const body = JSON.stringify({ email: "owner@example.test", password: "Correct-horse-battery-9" });
  assert.equal((await throughProxy("/api/auth/login", headers, body)).passed, true);
  const res = await login.POST(request("/api/auth/login", headers, body));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie") ?? "", /foldrun_session=/);
});

test("the CLI's own calls still pass: the headers Node's fetch really sends, no Origin, no Sec-Fetch-Site", async () => {
  // Capture what `foldrun login` sends (remoteFetch in foldrun-cli: Node's
  // fetch, a user agent, foldrun-version, an idempotency key, JSON).
  let seen: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => { seen = req.headers; req.resume(); req.on("end", () => res.end("{}")); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    const port = (server.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}/api/cli/login`, {
      method: "POST",
      headers: { "user-agent": "foldrun-cli/5.0.1", "foldrun-version": "2026-10-01", "idempotency-key": crypto.randomUUID(), "content-type": "application/json" },
      body: JSON.stringify({ hostname: "laptop" }),
    });
  } finally {
    server.close();
  }
  assert.equal(seen.origin, undefined, "Node's fetch sends no Origin");
  assert.equal(seen["sec-fetch-site"], undefined, "…and no Sec-Fetch-Site");
  const cliHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(seen)) if (typeof v === "string" && k !== "host" && k !== "content-length" && k !== "connection") cliHeaders[k] = v;
  const body = JSON.stringify({ hostname: "laptop" });
  const passed = await throughProxy("/api/cli/login", cliHeaders, body);
  assert.equal(passed.passed, true, `the CLI's sign-in request passes the proxy (${passed.status} ${passed.error})`);
  const res = await cliLogin.POST(request("/api/cli/login", cliHeaders, body));
  assert.equal(res.status, 200);
  assert.ok(((await res.json()) as { code?: string }).code, "and gets its code");
  // A Bearer client elsewhere is untouched, whatever it sends.
  assert.notEqual((await throughProxy("/api/workspaces", { authorization: "Bearer mda_x", "content-type": "text/plain" })).status, 403);
});

test("left alone: the unsubscribe form and a mail client's one-click POST are not JSON and need not be", async () => {
  // RFC 8058: a mail client POSTs List-Unsubscribe=One-Click, urlencoded, with no Origin.
  const client = await throughProxy("/api/unsubscribe?token=t", { "content-type": "application/x-www-form-urlencoded" }, "List-Unsubscribe=One-Click");
  assert.equal(client.passed, true);
  // Our own unsubscribe page posts a real HTML form.
  const page = await throughProxy("/api/unsubscribe", { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "sec-fetch-site": "same-origin" }, "token=t");
  assert.equal(page.passed, true);
});
