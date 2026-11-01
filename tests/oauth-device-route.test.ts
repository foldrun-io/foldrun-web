// POST /api/oauth/device and /api/oauth/device/<id>: a saved app connects
// with a code (RFC 8628) — started for a key with secrets:write, polled until
// approved, stored as the secret; another account's key cannot poll it.
//
//   node --import ./tests/register.mjs --test tests/oauth-device-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-device-route-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_EGRESS_ALLOW_PRIVATE = "1";
const { NextRequest } = await import("next/server");
const start = await import("../app/api/oauth/device/route.ts");
const poll = await import("../app/api/oauth/device/[id]/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { saveOAuthClient } = await import("../../foldrun-platform/src/oauth-clients.ts");
const { listSecrets } = await import("../../foldrun-core/src/secrets.ts");

for (const t of ["acme", "other"]) fs.mkdirSync(path.join(process.env.FOLDRUN_DATA, t, "workspaces/desk/flows"), { recursive: true });
const { key } = await createApiKey("acme", "full", "f@acme.test", undefined, "admin", null);
const { key: otherKey } = await createApiKey("other", "full", "o@other.test", undefined, "admin", null);

let approved = false;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/device") { res.end(JSON.stringify({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://p.example/device", expires_in: 600, interval: 5 })); return; }
    if (approved) { res.end(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 })); return; }
    res.statusCode = 400; res.end(JSON.stringify({ error: "authorization_pending" }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
test.after(() => server.close());

const req = (url: string, k: string, body?: object) => new NextRequest(`http://x${url}`, { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("start → pending → approved → stored; another account's key cannot poll it", async () => {
  await saveOAuthClient("acme", "tv", { authorize_url: `${base}/authorize`, token_url: `${base}/token`, client_id: "cid", client_secret: "shh", scopes: "openid", device_url: `${base}/device` });
  const s = await start.POST(req("/api/oauth/device", key, { client: "tv", secret: "TV_TOKEN", workspace: "desk" }));
  assert.equal(s.status, 200, await s.clone().text());
  const started = (await s.json()) as { id: string; user_code: string; interval: number };
  assert.equal(started.user_code, "ABCD-1234");
  const ctx = { params: Promise.resolve({ id: started.id }) };
  assert.deepEqual(await (await poll.POST(req(`/api/oauth/device/${started.id}`, key), ctx)).json(), { status: "pending" });
  const foreign = await poll.POST(req(`/api/oauth/device/${started.id}`, otherKey), { params: Promise.resolve({ id: started.id }) });
  assert.equal(foreign.status, 400);
  approved = true;
  const done = (await (await poll.POST(req(`/api/oauth/device/${started.id}`, key), ctx)).json()) as { status: string; name: string; tenant?: string };
  assert.equal(done.status, "connected");
  assert.equal(done.name, "TV_TOKEN");
  assert.equal(done.tenant, undefined, "the account is not echoed");
  assert.ok(listSecrets("acme", "desk").some((x) => x.name === "TV_TOKEN" && x.kind === "oauth2"));
});

test("an unknown saved app is 404; a bad secret name is refused before any provider is asked", async () => {
  assert.equal((await start.POST(req("/api/oauth/device", key, { client: "nope", secret: "X" }))).status, 404);
  assert.equal((await start.POST(req("/api/oauth/device", key, { client: "tv", secret: "lower-case" }))).status, 400);
});
