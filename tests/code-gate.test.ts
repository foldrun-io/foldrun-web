// The per-client gate on emailed-code sign-in (server/code-gate.ts), without a
// database: who counts as one client, which address is trusted at all, and
// when a block starts and ends. The routes that use it are in
// login-code-db.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

delete process.env.FOLDRUN_REDIS_URL; // the process's own counters

const gate = await import("../server/code-gate.ts");
const { edgeClientIp } = await import("../server/limits.ts");

const SECRET = "edge-secret-for-the-test";
const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
const withEnv = <T>(env: Record<string, string | undefined>, f: () => T): T => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return f();
  } finally {
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};

test("IPv4 is counted by the exact address", () => {
  assert.equal(gate.gateKey("203.0.113.7"), "203.0.113.7");
  assert.notEqual(gate.gateKey("203.0.113.7"), gate.gateKey("203.0.113.8"));
});

test("IPv6 is counted by its /64: any address inside it is the same client, the next /64 is not", () => {
  const a = gate.gateKey("2001:db8:abcd:12:1:2:3:4");
  assert.equal(a, "v6:2001:db8:abcd:12");
  assert.equal(gate.gateKey("2001:DB8:abcd:12:ffff:ffff:ffff:ffff"), a, "other host bits, same client");
  assert.equal(gate.gateKey("2001:db8:abcd:12::9"), a, "compressed form, same client");
  assert.equal(gate.gateKey("2001:db8:abcd:13::1"), "v6:2001:db8:abcd:13", "a neighbouring /64 is another client");
  assert.equal(gate.gateKey("2001:db8::1"), "v6:2001:db8:0:0", ":: inside the prefix reads as zero groups");
  assert.equal(gate.gateKey("::ffff:203.0.113.7"), "203.0.113.7", "an IPv4-mapped address is the IPv4 one");
  assert.equal(gate.gateKey("::ffff:cb00:7107"), "203.0.113.7", "also in hex form");
});

test("an address that cannot be a client is never counted: the proxy's, the cluster's, loopback, nonsense", () => {
  for (const ip of ["10.42.3.4", "127.0.0.1", "192.168.1.9", "172.20.0.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "", "not an ip", "999.1.1.1", null, undefined]) {
    assert.equal(gate.gateKey(ip), null, String(ip));
  }
});

test("the client's address is read only from a request our edge stamped; a header anyone can send is ignored", () => {
  const cf = { "x-foldrun-edge": SECRET, "cf-connecting-ip": "203.0.113.7" };
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(gate.codeGateKey(req(cf)), "203.0.113.7");
    assert.equal(gate.codeGateKey(req({ ...cf, "x-forwarded-for": "198.51.100.1" })), "203.0.113.7", "x-forwarded-for never wins");
    assert.equal(gate.codeGateKey(req({ "cf-connecting-ip": "203.0.113.7" })), null, "no stamp");
    assert.equal(gate.codeGateKey(req({ ...cf, "x-foldrun-edge": "wrong" })), null, "wrong stamp");
    assert.equal(gate.codeGateKey(req({ ...cf, "cf-connecting-ip": "not-an-address" })), null, "not an address");
    assert.equal(gate.codeGateKey(req({ "x-foldrun-edge": SECRET })), null, "stamped but no address");
  });
  withEnv({ FOLDRUN_TRUST_PROXY: "cloudflare", FOLDRUN_EDGE_SECRET: "" }, () => {
    assert.equal(gate.codeGateKey(req({ "x-foldrun-edge": "", "cf-connecting-ip": "203.0.113.7" })), null, "an empty secret trusts nothing");
  });
  // The mode where x-forwarded-for is believed elsewhere (clientIp) is not trusted here.
  withEnv({ FOLDRUN_TRUST_PROXY: "1", FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(gate.codeGateKey(req({ "x-forwarded-for": "203.0.113.7", ...cf })), null);
    assert.equal(edgeClientIp(req({ "x-real-ip": "203.0.113.7" })), null);
  });
  withEnv({ FOLDRUN_TRUST_PROXY: undefined, FOLDRUN_EDGE_SECRET: SECRET }, () => {
    assert.equal(gate.codeGateKey(req(cf)), null, "no trusted proxy configured");
  });
});

test("four failures in fifteen minutes block the client for five minutes; the block ends on time; others are untouched", async () => {
  gate.resetCodeGate();
  const t0 = 1_000_000_000_000;
  const key = "203.0.113.7";
  assert.equal(await gate.codeGateBlocked(key, t0), false);
  for (let i = 1; i <= gate.FAILURES - 1; i++) assert.equal(await gate.codeGateFailed(key, t0 + i * 1000), false, `failure ${i} is not yet a block`);
  assert.equal(await gate.codeGateBlocked(key, t0 + 4000), false, "three failures: not blocked");
  assert.equal(await gate.codeGateFailed(key, t0 + 4000), true, "the fourth earns the block");
  assert.equal(await gate.codeGateBlocked(key, t0 + 5000), true);
  assert.equal(await gate.codeGateBlocked("203.0.113.8", t0 + 5000), false, "another client is not blocked");
  assert.equal(await gate.codeGateBlocked(key, t0 + 4000 + gate.BLOCK_SEC * 1000 - 1), true, "still blocked a moment before five minutes");
  assert.equal(await gate.codeGateBlocked(key, t0 + 4000 + gate.BLOCK_SEC * 1000 + 1), false, "free after five minutes");
});

test("failures older than the window are forgotten: three, fifteen minutes of quiet, one more is no block", async () => {
  gate.resetCodeGate();
  const t0 = 2_000_000_000_000;
  const key = "203.0.113.9";
  for (let i = 0; i < 3; i++) await gate.codeGateFailed(key, t0 + i);
  assert.equal(await gate.codeGateFailed(key, t0 + gate.WINDOW_SEC * 1000 + 10), false);
  assert.equal(await gate.codeGateBlocked(key, t0 + gate.WINDOW_SEC * 1000 + 11), false);
});

test("the block writes one counts-only line: how many, how long, never an address", async () => {
  gate.resetCodeGate();
  const lines: string[] = [];
  const log = console.log, warn = console.warn, err = console.error;
  console.log = console.warn = console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    for (let i = 0; i < gate.FAILURES; i++) await gate.codeGateFailed("203.0.113.77", 3_000_000_000_000 + i);
  } finally {
    console.log = log; console.warn = warn; console.error = err;
  }
  const mine = lines.filter((l) => l.includes("auth.code_client_blocked"));
  assert.equal(mine.length, 1);
  assert.match(mine[0], /count=4/);
  assert.match(mine[0], /secs=300/);
  assert.doesNotMatch(mine[0], /203\.0\.113\.77/);
});
