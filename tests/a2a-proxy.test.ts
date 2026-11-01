// /a2a at the front door (1 Nov 2026): the same floor as /api — raw-path
// guard, body limit, cross-site rule — answered as JSON-RPC, and the session
// cookie taken off the request so nothing behind it can sign in with one.
//
//   node --import ./tests/register.mjs --test tests/a2a-proxy.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-a2a-proxy-"));
process.env.FOLDRUN_SECRET_KEY = "a2a-proxy-key";
process.env.FOLDRUN_API_RATE_LIMIT = "off";
const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");

const at = (pathname: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  proxy(new NextRequest(`https://app.example.test${pathname}`, { method: init.method ?? "POST", headers: init.headers, body: init.body }));
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";
const rpcError = async (r: Response) => ((await r.json()) as { jsonrpc: string; error: { code: number } });

test("a well-formed A2A call passes, with the security headers, and without its cookie", async () => {
  const r = await at("/a2a/acme/desk/flows/leads", {
    headers: { authorization: "Bearer mda_x", "content-type": "application/json", cookie: "foldrun_session=abc; other=1" },
    body: "{}",
  });
  assert.ok(passes(r));
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const overridden = (r.headers.get("x-middleware-override-headers") ?? "").split(",");
  assert.ok(!overridden.includes("cookie"), "the cookie is not forwarded");
  assert.equal(r.headers.get("x-middleware-request-cookie"), null);
  assert.ok(passes(await at("/a2a/acme/desk/flows/leads/.well-known/agent-card.json", { method: "GET" })));
});

test("an encoded separator or a dot segment is refused before any route, as JSON-RPC", async () => {
  for (const p of ["/a2a/acme/desk/flows/..%2F..%2Fother", "/a2a/acme/../rival/desk"]) {
    const r = await at(p, { headers: { authorization: "Bearer mda_x" }, body: "{}" });
    if (passes(r)) continue; // the URL parser may already have folded `..`
    assert.equal(r.status, 400, p);
    const body = await rpcError(r);
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.error.code, -32600);
  }
  const encoded = await at("/a2a/acme/desk/flows/a%2Fb", { headers: { authorization: "Bearer mda_x" }, body: "{}" });
  assert.equal(encoded.status, 400);
});

test("a body declared over the A2A limit is 413; a cookie-carrying cross-site write is 403", async () => {
  const big = await at("/a2a/acme/desk/flows/leads", { headers: { authorization: "Bearer mda_x", "content-length": String(2 * 1024 * 1024) } });
  assert.equal(big.status, 413);
  assert.equal((await rpcError(big)).error.code, -32600);
  const forged = await at("/a2a/acme/desk/flows/leads", { headers: { cookie: "foldrun_session=abc", origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" });
  assert.equal(forged.status, 403);
});
