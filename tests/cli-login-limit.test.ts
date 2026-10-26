// `foldrun login`'s first step is open to anyone, and the install keeps at
// most 200 requests waiting: one client could hold all 200 and lock every
// person out (FOL-94). Now ten per caller per ten minutes — the caller read
// as signup and login read it (server/limits.ts clientIp): Cloudflare's
// cf-connecting-ip, believed only beside our edge's x-foldrun-edge stamp.
// A request without the stamp shares one count no person lands in; neither
// X-Forwarded-For nor a forged cf-connecting-ip makes a new caller.
//
//   node --import ./tests/register.mjs --test tests/cli-login-limit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-limit-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;

const { NextRequest } = await import("next/server");
const login = await import("../app/api/cli/login/route.ts");
const { clientIp } = await import("../server/limits.ts");

const ask = (headers: Record<string, string>) =>
  login.POST(new NextRequest("http://x/api/cli/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ hostname: "laptop" }) }));

const SECRET = "edge-secret-for-tests";

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const edge = (fn: () => Promise<void>) => withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: SECRET }, fn);
const stamped = (ip: string) => ({ "cf-connecting-ip": ip, "x-foldrun-edge": SECRET });

test("the eleventh request from one caller in ten minutes is a 429, and forged headers do not reset it", () =>
  edge(async () => {
    const caller = stamped("203.0.113.7");
    for (let i = 1; i <= 10; i++) assert.equal((await ask(caller)).status, 200, `request ${i}`);
    const eleventh = await ask(caller);
    assert.equal(eleventh.status, 429);
    assert.ok(Number(eleventh.headers.get("retry-after")) > 0);
    // A client's own forwarding headers change nothing: the stamped edge says who it is.
    for (const forged of ["198.51.100.1", "10.0.0.1, 203.0.113.7", "1.2.3.4"]) {
      const res = await ask({ ...caller, "x-forwarded-for": forged, "x-real-ip": forged });
      assert.equal(res.status, 429, `x-forwarded-for: ${forged}`);
    }
    // Another caller is another count.
    assert.equal((await ask(stamped("203.0.113.8"))).status, 200);
  }));

test("a cf-connecting-ip without the edge stamp is not a separate caller: all unstamped requests share one count", () =>
  edge(async () => {
    // Each forged address, no stamp (or a wrong one): one shared count, not ten of their own.
    for (let i = 1; i <= 10; i++) {
      const res = await ask({ "cf-connecting-ip": `198.51.100.${i}`, ...(i % 2 ? {} : { "x-foldrun-edge": "wrong" }) });
      assert.equal(res.status, 200, `unstamped ${i}`);
    }
    assert.equal((await ask({ "cf-connecting-ip": "198.51.100.99" })).status, 429, "an eleventh forged address is the same count");
    // A person through the edge is never in that count.
    assert.equal((await ask(stamped("203.0.113.50"))).status, 200);
  }));

test("no trusted proxy, or no edge secret: no caller, no shared count — the install-wide cap stands alone", async () => {
  for (const env of [{ FOLDRUN_TRUST_PROXY: undefined, FOLDRUN_EDGE_SECRET: undefined }, { FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: undefined }]) {
    await withEnv(env, async () => {
      for (let i = 1; i <= 12; i++) assert.equal((await ask({ "cf-connecting-ip": "203.0.113.60" })).status, 200, `${JSON.stringify(env)} request ${i}`);
    });
  }
});

test("clientIp: cloudflare reads cf-connecting-ip only with the edge stamp; 1 keeps the first forwarded hop; unset trusts nothing", async () => {
  const req = (h: Record<string, string>) => new NextRequest("http://x/", { headers: h });
  const both = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6, 203.0.113.9" };
  await edge(async () => {
    assert.equal(clientIp(req({ ...both, "x-foldrun-edge": SECRET })), "203.0.113.9");
    assert.equal(clientIp(req(both)), null, "no stamp: no caller");
    assert.equal(clientIp(req({ ...both, "x-foldrun-edge": SECRET + "x" })), null, "wrong stamp (other length)");
    assert.equal(clientIp(req({ ...both, "x-foldrun-edge": "X".repeat(SECRET.length) })), null, "wrong stamp (same length)");
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6", "x-foldrun-edge": SECRET })), null, "no Cloudflare header: not the forged one");
  });
  await withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: undefined }, async () =>
    assert.equal(clientIp(req({ ...both, "x-foldrun-edge": "" })), null, "no secret: never believed"));
  await withEnv({ FOLDRUN_TRUST_PROXY: "1" }, async () => assert.equal(clientIp(req(both)), "6.6.6.6"));
  await withEnv({ FOLDRUN_TRUST_PROXY: undefined }, async () => assert.equal(clientIp(req(both)), null));
});
