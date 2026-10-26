// clientIp: who the caller is, for the per-IP limits. Behind Cloudflare the
// answer is cf-connecting-ip — but only for a request that came through
// Cloudflare, which on the dev box (also reachable from the LAN) only the
// edge secret proves (FOL-94, foldrun-infra #72).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "@/server/limits";

const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
const SECRET = "a-long-edge-secret-for-the-test-only";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const before = { FOLDRUN_TRUST_PROXY: process.env.FOLDRUN_TRUST_PROXY, FOLDRUN_EDGE_SECRET: process.env.FOLDRUN_EDGE_SECRET };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("no trust setting: no address, whatever the headers say", () => {
  withEnv({ FOLDRUN_TRUST_PROXY: undefined, FOLDRUN_EDGE_SECRET: undefined }, () => {
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" })), null);
  });
});

test("cloudflare with an edge secret: the address only beside Cloudflare's stamp", () => {
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-foldrun-edge": SECRET })), "203.0.113.9");
    // Straight from the LAN, a forged CF header: no stamp, no address.
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" })), null);
    // A wrong stamp, a shorter one, an empty one: no address.
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-foldrun-edge": SECRET.replace(/.$/, "x") })), null);
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-foldrun-edge": SECRET.slice(1) })), null);
    assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-foldrun-edge": "" })), null);
  });
});

test("cloudflare: never x-forwarded-for or x-real-ip, whose first entry the client writes", () => {
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(clientIp(req({ "x-foldrun-edge": SECRET, "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" })), null);
  });
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: undefined }, () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.1" })), null);
  });
});

test("cloudflare without an edge secret, or an empty one: no address — anyone's Worker can set cf-connecting-ip", () => {
  for (const secret of [undefined, ""]) {
    withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: secret }, () => {
      assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9" })), null, `secret ${JSON.stringify(secret)}`);
      assert.equal(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-foldrun-edge": "" })), null);
    });
  }
});

test("cloudflare with the stamp: surrounding space is trimmed from the address", () => {
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(clientIp(req({ "cf-connecting-ip": " 203.0.113.9 ", "x-foldrun-edge": SECRET })), "203.0.113.9");
    assert.equal(clientIp(req({ "x-foldrun-edge": SECRET })), null);
  });
});

test("1 still reads the forwarded address, as before", () => {
  withEnv({ FOLDRUN_TRUST_PROXY: "1", FOLDRUN_EDGE_SECRET: undefined }, () => {
    assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.42.0.5" })), "198.51.100.1");
    assert.equal(clientIp(req({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  });
});
