// FOL-398: a caller in Iran is told the API's Iran front (a CloudFront name
// the country's filter lets through) wherever the platform tells a program
// where to call — /v1/version's urls.api, /v1/me's modelsUrl, a key's
// gatewayUrl — and everyone else the install's own address.
//
//   node --import ./tests/register.mjs --test tests/iran-front.test.ts

import test from "node:test";
import assert from "node:assert/strict";

process.env.FOLDRUN_PUBLIC_API_URL = "https://api.example.test";
process.env.FOLDRUN_PUBLIC_URL = "https://dash.example.test";
process.env.FOLDRUN_GATEWAY_URL = "https://api.example.test";
process.env.FOLDRUN_IRAN_API_URL = "https://d123.cloudfront.net/";
process.env.FOLDRUN_TRUST_PROXY = "cloudflare";

const { NextRequest } = await import("next/server");
const { addressFor, fromIran, iranFrontUrl } = await import("../server/iran-front.ts");
const { gatewayUrl } = await import("../server/gateway-keys.ts");
const version = (await import("../app/v1/version/route.ts")) as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };

const req = (headers: Record<string, string> = {}) => new NextRequest("https://api.example.test/v1/version", { headers });
const apiOf = async (headers: Record<string, string>) => ((await (await version.GET(req(headers))).json()) as { urls: { api: string | null; app: string | null } }).urls;

test("the front's address is an https origin, else none", () => {
  assert.equal(iranFrontUrl(), "https://d123.cloudfront.net");
  process.env.FOLDRUN_IRAN_API_URL = "http://d123.cloudfront.net";
  assert.equal(iranFrontUrl(), null);
  process.env.FOLDRUN_IRAN_API_URL = "not a url";
  assert.equal(iranFrontUrl(), null);
  process.env.FOLDRUN_IRAN_API_URL = "https://d123.cloudfront.net/";
});

test("a caller in Iran (Cloudflare's country) is given the front; others the install's address", async () => {
  assert.deepEqual(await apiOf({ "cf-ipcountry": "IR" }), { api: "https://d123.cloudfront.net", app: "https://dash.example.test" });
  assert.deepEqual(await apiOf({ "cf-ipcountry": "AU" }), { api: "https://api.example.test", app: "https://dash.example.test" });
  assert.deepEqual(await apiOf({}), { api: "https://api.example.test", app: "https://dash.example.test" });
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
