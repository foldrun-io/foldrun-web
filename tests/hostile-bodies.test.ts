// Bodies of the wrong shape through the real routes (FOL-199, 16 Nov 2026):
// the hosted fuzz run (Schemathesis) found PATCH …/source, POST …/shares and
// POST /api/mcp/oauth/token answering 500 for JSON that parses but is not
// what the route reads — `null`, an array, a number where a path goes, a
// ttlDays no date can hold — and malformed JSON logged as an internal error.
// Each is the caller's mistake: a 4xx that says so, never a 500.
//
//   node --import ./tests/register.mjs --test tests/hostile-bodies.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hostile-bodies-"));
process.env.FOLDRUN_DATA = path.join(BASE, "data");
process.env.FOLDRUN_PUBLIC_URL = "https://foldrun.test";
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { errorStatus } = await import("../server/api.ts");
type Ctx = { params: Promise<Record<string, string>> };
type H = (req: InstanceType<typeof NextRequest>, ctx: Ctx) => Promise<Response>;
const mod = async (p: string) => (await import(p)) as Record<string, H>;
const source = await mod("../app/api/workspaces/[workspace]/source/route.ts");
const shares = await mod("../app/api/workspaces/[workspace]/shares/route.ts");
const token = await mod("../app/api/mcp/oauth/token/route.ts");
const revoke = await mod("../app/api/mcp/oauth/revoke/route.ts");
const cliLogin = await mod("../app/api/cli/login/route.ts");
const oauthClients = await mod("../app/api/oauth/clients/route.ts");
const { tooManyAttempts } = await import("../server/limits.ts");
const { openapiDocument } = await import("../server/openapi.ts");
const prefs = await mod("../app/api/me/preferences/route.ts");
const agentsMd = await mod("../app/api/account/agents-md/route.ts");
const { createUser } = await import("../server/users.ts");
const deployRoute = await mod("../app/api/workspaces/[workspace]/deploy/route.ts");
const { jsonObject } = await import("../server/body.ts");

const TENANT = "acme";
const WS = "desk";
const ws = path.join(process.env.FOLDRUN_DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "knowledge"), { recursive: true });
fs.mkdirSync(path.join(ws, "storage"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "knowledge", "a.md"), "# a\n");
fs.writeFileSync(path.join(ws, "storage", "report.md"), "# report\n");

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const params = (p: Record<string, string>): Ctx => ({ params: Promise.resolve(p) });
let ip = 0;
const send = (method: string, url: string, body: string, auth = true) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    body,
    headers: {
      "content-type": "application/json",
      // A fresh address per call: the open OAuth endpoints are rate-limited per address.
      "x-forwarded-for": `198.51.100.${(ip++ % 250) + 1}`,
      ...(auth ? { authorization: `Bearer ${key}` } : {}),
    },
  });

// JSON that parses to something other than the object a route reads, and
// JSON that does not parse at all.
const SHAPES = ["null", "[]", "7", '"x"', "true", "{not json", '{"a":'];

async function never500(label: string, res: Promise<Response>) {
  const r = await res;
  assert.ok(r.status < 500, `${label}: ${r.status} ${await r.text()}`);
  assert.ok(r.status >= 400, `${label}: expected a refusal, got ${r.status}`);
}

test("source PUT, PATCH and DELETE refuse a body of the wrong shape with a 400, never a 500", async () => {
  const at = params({ workspace: WS });
  const url = `/api/workspaces/${WS}/source`;
  for (const b of SHAPES) {
    await never500(`PUT ${b}`, source.PUT(send("PUT", url, b), at));
    await never500(`PATCH ${b}`, source.PATCH(send("PATCH", url, b), at));
    await never500(`DELETE ${b}`, source.DELETE(send("DELETE", url, b), at));
  }
  // Fields of the wrong type: a number where a path goes reached core and
  // threw ERR_INVALID_ARG_TYPE.
  await never500("PUT path:7", source.PUT(send("PUT", url, JSON.stringify({ path: 7, content: "x" })), at));
  await never500("PATCH from:7", source.PATCH(send("PATCH", url, JSON.stringify({ from: 7, to: "knowledge/b.md" })), at));
  await never500("PATCH to:{}", source.PATCH(send("PATCH", url, JSON.stringify({ from: "knowledge/a.md", to: {} })), at));
  await never500("PATCH to:[]", source.PATCH(send("PATCH", url, JSON.stringify({ from: "knowledge/a.md", to: ["x"] })), at));
  await never500("DELETE path:true", source.DELETE(send("DELETE", url, JSON.stringify({ path: true })), at));
  assert.ok(fs.existsSync(path.join(ws, "knowledge", "a.md")), "nothing was moved or removed");
  // The right shape still works.
  const ok = await source.PATCH(send("PATCH", url, JSON.stringify({ from: "knowledge/a.md", to: "knowledge/b.md" })), at);
  assert.equal(ok.status, 200, await ok.text());
  assert.ok(fs.existsSync(path.join(ws, "knowledge", "b.md")));
});

test("shares POST refuses a body of the wrong shape, a non-string path and a ttlDays no date holds", async () => {
  const url = `/api/workspaces/${WS}/shares`;
  for (const at of [params({ workspace: WS }), params({ workspace: "0" })]) {
    for (const b of SHAPES) await never500(`POST ${b}`, shares.POST(send("POST", url, b), at));
    await never500("path:7", shares.POST(send("POST", url, JSON.stringify({ path: 7 })), at));
    await never500("ttlDays:'x'", shares.POST(send("POST", url, JSON.stringify({ path: "storage/report.md", ttlDays: "x" })), at));
    await never500("ttlDays:1e20", shares.POST(send("POST", url, JSON.stringify({ path: "storage/report.md", ttlDays: 1e20 })), at));
  }
  const ok = await shares.POST(send("POST", url, JSON.stringify({ path: "storage/report.md", ttlDays: 2 })), params({ workspace: WS }));
  assert.equal(ok.status, 200, await ok.text());
  const forever = await shares.POST(send("POST", url, JSON.stringify({ path: "storage/report.md", ttlDays: null })), params({ workspace: WS }));
  assert.equal(((await forever.json()) as { expiresAt: string | null }).expiresAt, null);
});

test("the MCP OAuth token and revocation endpoints answer invalid_request for JSON that is not an object", async () => {
  for (const [name, route] of [["token", token], ["revoke", revoke]] as const) {
    for (const b of SHAPES) {
      const r = await route.POST(send("POST", `/api/mcp/oauth/${name}`, b, false), params({}));
      assert.ok(r.status >= 400 && r.status < 500, `${name} ${b}: ${r.status}`);
      const j = (await r.json()) as { error: string };
      assert.ok(typeof j.error === "string" && j.error !== "server_error", `${name} ${b}: ${JSON.stringify(j)}`);
    }
  }
});

test("malformed JSON is the caller's 400, not an internal error", () => {
  const out = errorStatus(new SyntaxError("Unexpected token } in JSON"));
  assert.deepEqual(out, { status: 400, message: "malformed JSON", internal: false });
});

// The second hosted fuzz run (43825686618) found these.
test("POST /api/cli/login and /api/oauth/clients refuse a body of the wrong shape, never a 500", async () => {
  for (const b of SHAPES) await never500(`cli/login ${b}`, cliLogin.POST(send("POST", "/api/cli/login", b, false), params({})));
  for (const b of SHAPES) await never500(`oauth/clients ${b}`, oauthClients.POST(send("POST", "/api/oauth/clients", b), params({})));
  const config = { authorize_url: "https://p.test/a", token_url: "https://p.test/t", client_id: "cid", client_secret: "s", scopes: "" };
  for (const [field, value] of [["authorize_url", ["https://p.test/a"]], ["client_id", 7], ["token_url", {}], ["authorize_extra", [1]], ["pkce", "no"]] as const) {
    await never500(`oauth/clients ${field}`, oauthClients.POST(send("POST", "/api/oauth/clients", JSON.stringify({ name: "app", config: { ...config, [field]: value } })), params({})));
  }
  await never500("oauth/clients config:7", oauthClients.POST(send("POST", "/api/oauth/clients", JSON.stringify({ name: "app", config: 7 })), params({})));
});

test("every 429 a limiter here sends carries retry_after, as the document's RateLimited requires", async () => {
  const r = tooManyAttempts(42);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "42");
  const j = (await r.json()) as { error: string; retry_after: number };
  assert.equal(typeof j.error, "string");
  assert.equal(j.retry_after, 42);
});

test("the document lists the statuses the fuzz found, and /api/mcp refuses in JSON-RPC's shape", () => {
  const doc = openapiDocument() as { paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>; components: { responses: Record<string, unknown> } };
  const has = (method: string, p: string, status: string) => {
    const op = doc.paths[p]?.[method];
    if (!op) return; // a route this edition does not serve
    assert.ok(op.responses[status], `${method.toUpperCase()} ${p} documents ${status}`);
  };
  has("post", "/api/library/{kind}", "409");
  has("post", "/api/oauth/reconnect", "404");
  has("post", "/api/workspaces", "402");
  has("post", "/api/workspaces/{workspace}/deploy", "402");
  has("post", "/api/workspaces/{workspace}/flows/{flow}/run", "402");
  const mcp = doc.paths["/api/mcp"].post.responses;
  assert.equal(mcp["400"].$ref, "#/components/responses/RpcError");
  assert.ok(doc.components.responses.RpcError);
  // Every other route keeps the API's own { error }.
  assert.equal(doc.paths["/api/workspaces"].post.responses["400"].$ref, "#/components/responses/Error");
});

// The third hosted fuzz run (43840533439): PATCH /api/me/preferences with a
// bare -481 (`in` on a number); the same review found PUT
// /api/account/agents-md reading body.content of `null`.
test("PATCH /api/me/preferences and PUT /api/account/agents-md refuse a body that is not a JSON object", async () => {
  // A person (preferences are a person's), with a key of their own.
  await createUser("owner@prefs.test", "Qz8-vmT2-plx9-Wr4k-hst", "prefs-co", { request: "free" });
  const own = (await createApiKey("prefs-co", "test", "owner@prefs.test", undefined, "admin")).key;
  const as = (method: string, url: string, body: string) =>
    new NextRequest(`http://localhost${url}`, { method, body, headers: { "content-type": "application/json", authorization: `Bearer ${own}`, "x-forwarded-for": `198.51.100.${(ip++ % 250) + 1}` } });
  for (const b of [...SHAPES, "-481"]) {
    await never500(`preferences ${b}`, prefs.PATCH(as("PATCH", "/api/me/preferences", b), params({})));
    await never500(`agents-md ${b}`, agentsMd.PUT(as("PUT", "/api/account/agents-md", b), params({})));
  }
  const ok = await prefs.PATCH(as("PATCH", "/api/me/preferences", JSON.stringify({ theme: "dark" })), params({}));
  const text = await ok.text();
  assert.equal(ok.status, 200, text);
  assert.equal((JSON.parse(text) as { theme: string }).theme, "dark");
});

// The fourth hosted fuzz run (43860037381): POST …/deploy with a file path
// that names a folder ("", ".", "knowledge/") reached open() — EISDIR, a 500.
test("POST …/deploy answers 400 for a path that names no file or is also a folder, never a 500", async () => {
  const url = `/api/workspaces/${WS}/deploy`;
  const good = [{ path: "AGENTS.md", content: `---\nname: ${WS}\n---\n` }, { path: "knowledge/a.md", content: "# a\n" }];
  for (const bad of ["", ".", "./", "knowledge/", "knowledge", "x/", "a/../knowledge"]) {
    for (const dryRun of [false, true]) {
      const r = await deployRoute.POST(send("POST", url, JSON.stringify({ files: [...good, { path: bad, content: "x" }], dryRun })), params({ workspace: WS }));
      const text = await r.text();
      assert.equal(r.status, 400, `${JSON.stringify(bad)} dryRun:${dryRun}: ${r.status} ${text}`);
      assert.match(text, /name no file/);
    }
  }
  assert.ok(fs.existsSync(path.join(ws, "AGENTS.md")), "the workspace is untouched");
});

test("the document lists 202 (async) and 409 (already running) for an eval run", () => {
  const doc = openapiDocument() as { paths: Record<string, Record<string, { responses: Record<string, { $ref?: string; content?: unknown }> }>> };
  const op = doc.paths["/api/workspaces/{workspace}/evals/{evalName}/run"].post.responses;
  assert.ok(op["200"] && op["202"] && op["409"]);
  assert.equal(op["202"].$ref, undefined, "202 is a success with its own body, not a refusal");
  assert.ok(op["202"].content);
});

// The fifth hosted fuzz run (43900332176): POST /api/mcp/clients with a NUL
// in the name was a 500 on the hosted stack — Postgres cannot hold \u0000 in
// jsonb. Every route reading its body through jsonObject refuses one now.
test("a NUL in any string or key of a body is a 400, never reaching storage", async () => {
  for (const b of ['{"name":"a\\u0000b"}', '{"a\\u0000":1}', '{"x":{"y":["ok","\\u0000"]}}']) {
    await assert.rejects(jsonObject(new Request("http://localhost/", { method: "POST", body: b })), (e: Error & { status?: number }) => e.status === 400 && /NUL/.test(e.message), b);
  }
  // A backslash followed by u0000 as text is not a NUL, and is kept.
  assert.deepEqual(await jsonObject(new Request("http://localhost/", { method: "POST", body: '{"p":"C:\\\\u0000"}' })), { p: "C:\\u0000" });
});

test("the document lists 409 (that name exists) for creating a flow", () => {
  const doc = openapiDocument() as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
  assert.ok(doc.paths["/api/workspaces/{workspace}/flows"].post.responses["409"]);
  // A mail that cannot be turned off (the sixth hosted fuzz run, 43911475419).
  assert.ok(doc.paths["/api/me/notifications"].patch.responses["409"]);
});
