// FOL-398: a caller in Iran is told the API's Iran front (a CloudFront name
// the country's filter lets through) wherever the platform tells a program
// where to call — /v1/version's urls.api, /v1/me's modelsUrl, a key's
// gatewayUrl — and everyone else the install's own address.
// FOL-402: the front and the operator's notice are console settings
// (network.iran_*) over the environment; a caller in Iran is also told every
// front and the notice; refusals with a catalogued code lead with what to
// do; GET/POST /v1/network/bytes is what `foldrun doctor` probes with.
//
//   node --import ./tests/register.mjs --test tests/iran-front.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-iran-front-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_PUBLIC_API_URL = "https://api.example.test";
process.env.FOLDRUN_PUBLIC_URL = "https://dash.example.test";
process.env.FOLDRUN_GATEWAY_URL = "https://api.example.test";
process.env.FOLDRUN_IRAN_API_URL = "https://d123.cloudfront.net/";
process.env.FOLDRUN_TRUST_PROXY = "cloudflare";

const { NextRequest } = await import("next/server");
const { addressFor, fromIran, iranFrontUrl } = await import("../server/iran-front.ts");
const { gatewayUrl } = await import("../server/gateway-keys.ts");
const settings = await import("../../foldrun-platform/src/settings.ts");
const { errorBody } = await import("../server/error-shape.ts");
const { createApiKey } = await import("../server/auth.ts");
const version = (await import("../app/v1/version/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
const me = (await import("../app/v1/me/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
const bytes = (await import("../app/v1/network/bytes/route.ts")) as {
  GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
  POST: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
};

const req = (headers: Record<string, string> = {}) => new NextRequest("https://api.example.test/v1/version", { headers });
const answer = async (headers: Record<string, string>) => (await (await version.GET(req(headers))).json()) as { urls: Record<string, unknown>; notice?: { id: string; message: string; command: string | null } };
const apiOf = async (headers: Record<string, string>) => (await answer(headers)).urls;
const row = (key: string, value: unknown, v: number) => ({ key, value, version: v, updatedBy: "op@example.com", updatedAt: new Date().toISOString() }) as never;

test("the front's address is an https CloudFront origin, else none", () => {
  assert.equal(iranFrontUrl(), "https://d123.cloudfront.net");
  process.env.FOLDRUN_IRAN_API_URL = "http://d123.cloudfront.net";
  assert.equal(iranFrontUrl(), null);
  process.env.FOLDRUN_IRAN_API_URL = "not a url";
  assert.equal(iranFrontUrl(), null);
  process.env.FOLDRUN_IRAN_API_URL = "https://api.evil.example";
  assert.equal(iranFrontUrl(), null, "a front is a CloudFront name, nothing else");
  process.env.FOLDRUN_IRAN_API_URL = "https://d123.cloudfront.net/";
});

test("a caller in Iran (Cloudflare's country) is given the front; others the install's address", async () => {
  assert.deepEqual(await apiOf({ "cf-ipcountry": "IR" }), { api: "https://d123.cloudfront.net", app: "https://dash.example.test", gateway: "https://d123.cloudfront.net", fronts: ["https://d123.cloudfront.net"] });
  assert.deepEqual(await apiOf({ "cf-ipcountry": "AU" }), { api: "https://api.example.test", app: "https://dash.example.test", gateway: "https://api.example.test" }, "the fronts are not named to anyone else");
  assert.deepEqual(await apiOf({}), { api: "https://api.example.test", app: "https://dash.example.test", gateway: "https://api.example.test" });
  assert.equal(gatewayUrl(req({ "cf-ipcountry": "ir" })), "https://d123.cloudfront.net");
  assert.equal(gatewayUrl(req({ "cf-ipcountry": "DE" })), "https://api.example.test");
  assert.equal(gatewayUrl(), "https://api.example.test", "no request, the install's address");
});

test("a request the front carried keeps the front (Cloudflare sees CloudFront's country)", async () => {
  assert.equal((await apiOf({ "x-foldrun-front": "ir", "cf-ipcountry": "DE" })).api, "https://d123.cloudfront.net");
  assert.equal(gatewayUrl(req({ "x-foldrun-front": "ir" })), "https://d123.cloudfront.net");
});

test("the country is believed only behind Cloudflare with the edge stamp", () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  assert.equal(fromIran(req({ "cf-ipcountry": "IR" })), false);
  assert.equal(fromIran(req({ "x-foldrun-front": "ir" })), true);
  process.env.FOLDRUN_TRUST_PROXY = "cloudflare";
});

test("no front configured, or no address of its own: nothing changes", () => {
  delete process.env.FOLDRUN_IRAN_API_URL;
  assert.equal(addressFor(req({ "cf-ipcountry": "IR" }), "https://api.example.test"), "https://api.example.test");
  process.env.FOLDRUN_IRAN_API_URL = "https://d123.cloudfront.net";
  assert.equal(addressFor(req({ "cf-ipcountry": "IR" }), null), null);
});

test("FOL-402: the console's front wins over the environment — one change moves every client", async () => {
  settings.writeSettingsFile([row("network.iran_api_url", "https://dnew9.cloudfront.net,https://dold1.cloudfront.net", 1)]);
  await settings.loadSettings();
  try {
    const urls = await apiOf({ "cf-ipcountry": "IR" });
    assert.equal(urls.api, "https://dnew9.cloudfront.net");
    assert.equal(urls.gateway, "https://dnew9.cloudfront.net");
    assert.deepEqual(urls.fronts, ["https://dnew9.cloudfront.net", "https://dold1.cloudfront.net"]);
  } finally {
    settings.writeSettingsFile([]);
    await settings.loadSettings();
  }
});

test("FOL-402: the notice, on /v1/version and /v1/me, to a caller in Iran only", async () => {
  settings.writeSettingsFile([row("network.iran_notice", "Iran's filter blocked our old address; restart Claude Code.", 1), row("network.iran_notice_action", "restart_claude_code", 2)]);
  await settings.loadSettings();
  try {
    const ir = await answer({ "cf-ipcountry": "IR" });
    assert.equal(ir.notice?.message, "Iran's filter blocked our old address; restart Claude Code.");
    assert.match(ir.notice?.id ?? "", /^[0-9a-f]{12}$/);
    assert.equal((await answer({ "cf-ipcountry": "DE" })).notice, undefined);
    const { key } = await createApiKey("acme", "probe", "o@acme.test", undefined, "viewer");
    const meOf = async (h: Record<string, string>) => (await (await me.GET(new NextRequest("https://api.example.test/v1/me", { headers: { authorization: `Bearer ${key}`, ...h } }))).json()) as { account: string; notice?: { message: string } };
    const mine = await meOf({ "x-foldrun-front": "ir" });
    assert.equal(mine.account, "acme");
    assert.equal(mine.notice?.message, "Iran's filter blocked our old address; restart Claude Code.");
    assert.equal((await meOf({})).notice, undefined);
  } finally {
    settings.writeSettingsFile([]);
    await settings.loadSettings();
  }
});

test("FOL-402: a refusal whose code the catalog knows leads with what to do, in Anthropic's shape only", () => {
  const b = errorBody("too many requests from this key", 429, { code: "rate_limited", retry_after: 3 }, "anthropic") as { error: { message: string; code: string; retry_after: number; foldrun: { code: string; fix: string } } };
  assert.match(b.error.message, /^Slow down and retry after the Retry-After seconds: too many requests/);
  assert.equal(b.error.code, "rate_limited");
  assert.equal(b.error.retry_after, 3);
  assert.equal(b.error.foldrun.code, "rate_limited");
  assert.deepEqual(errorBody("too many", 429, { code: "rate_limited" }, "legacy"), { error: "too many", code: "rate_limited" }, "the dashboard's body is as it was");
  const plain = errorBody("no run r_1", 404, { code: "something_else" }, "anthropic") as { error: Record<string, unknown> };
  assert.equal(plain.error.message, "no run r_1");
  assert.equal(plain.error.foldrun, undefined);
});

test("FOL-402: /v1/network/bytes gives random bytes, takes up to 64 KiB, and is never cached", async () => {
  const at = (q = "", init: RequestInit = {}) => new NextRequest(`https://api.example.test/v1/network/bytes${q}`, init as never);
  const big = await bytes.GET(at());
  assert.equal(big.status, 200);
  assert.equal(big.headers.get("content-type"), "application/octet-stream");
  assert.match(big.headers.get("cache-control") ?? "", /no-store/);
  const a = new Uint8Array(await big.arrayBuffer());
  assert.equal(a.byteLength, 65536);
  const again = new Uint8Array(await (await bytes.GET(at())).arrayBuffer());
  assert.notDeepEqual(a.slice(0, 32), again.slice(0, 32), "made for the call, not a fixed file");
  assert.equal((await (await bytes.GET(at("?size=1024"))).arrayBuffer()).byteLength, 1024);
  for (const bad of ["?size=0", "?size=65537", "?size=abc", "?size=1e3"]) assert.equal((await bytes.GET(at(bad))).status, 400, bad);
  const up = await bytes.POST(at("", { method: "POST", body: new Uint8Array(65536) }));
  assert.equal(up.status, 200);
  assert.deepEqual(await up.json(), { received: 65536 });
  assert.equal((await bytes.POST(at("", { method: "POST", body: new Uint8Array(65537) }))).status, 413);
  const streamed = new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(30_000)); c.close(); } });
  assert.equal((await bytes.POST(at("", { method: "POST", body: streamed, duplex: "half" } as RequestInit))).status, 413, "past 64 KiB without a length: refused as it arrives");
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    let n = 0;
    while (n < 40 && (await bytes.GET(at("?size=1", { headers: ip }))).status === 200) n++;
    assert.equal(n, 30, "one address is held to its share");
    assert.equal((await bytes.GET(at("?size=1", { headers: { "x-forwarded-for": "203.0.113.10" } }))).status, 200, "another is not");
  } finally {
    process.env.FOLDRUN_TRUST_PROXY = "cloudflare";
  }
});
