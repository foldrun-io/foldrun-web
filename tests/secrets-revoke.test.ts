// Deleting or replacing an oauth2 secret revokes its old grant at the
// provider (RFC 7009) — after the write, reported in the answer, never a
// reason to keep the secret.
//
//   node --import ./tests/register.mjs --test tests/secrets-revoke.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-secrets-revoke-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
// The fake provider is on 127.0.0.1; the SSRF guard refuses that otherwise.
process.env.FOLDRUN_EGRESS_ALLOW_PRIVATE = "1";
const { NextRequest } = await import("next/server");
const secrets = await import("../app/api/secrets/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { listSecrets } = await import("../../foldrun-core/src/secrets.ts");

fs.mkdirSync(path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk/flows"), { recursive: true });
fs.writeFileSync(path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk/AGENTS.md"), "---\nname: desk\n---\n");
const { key } = await createApiKey("acme", "full", "f@acme.test", undefined, "admin", null);

let mode: "ok" | "down" = "ok";
const revoked: string[] = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (mode === "down") { res.statusCode = 503; res.end("{}"); return; }
    revoked.push(new URLSearchParams(body).get("token")!);
    res.end("{}");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
test.after(() => server.close());

const call = (fn: (r: InstanceType<typeof NextRequest>) => Promise<Response>, method: string, body: object) =>
  fn(new NextRequest("http://x/api/secrets", { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
const recipe = (rt: string, client_id = "cid") => ({ token_url: `${base}/token`, client_id, client_secret: "shh", refresh_token: rt, revocation_url: `${base}/revoke` });

test("replacing an oauth2 secret: the same app revokes nothing (per-app revocation would end the new grant); another app's old grant is revoked", async () => {
  assert.equal((await call(secrets.PUT, "PUT", { name: "CRM", workspace: "desk", oauth2: recipe("rt-old") })).status, 200);
  const same = await call(secrets.PUT, "PUT", { name: "CRM", workspace: "desk", oauth2: recipe("rt-mid") });
  assert.deepEqual(((await same.json()) as { revoked: unknown }).revoked, { skipped: "same-app", revoked: [] });
  const res = await call(secrets.PUT, "PUT", { name: "CRM", workspace: "desk", oauth2: recipe("rt-new", "cid-2") });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { revoked: unknown }).revoked, { revoked: ["refresh_token"] });
  assert.deepEqual(revoked, ["rt-mid"]);
});

test("deleting one of two connections made with the same app revokes nothing — the provider may end both", async () => {
  await call(secrets.PUT, "PUT", { name: "ADS", oauth2: recipe("rt-ads", "shared-app") });
  await call(secrets.PUT, "PUT", { name: "SEARCH", workspace: "desk", oauth2: recipe("rt-search", "shared-app") });
  const r = await call(secrets.DELETE, "DELETE", { name: "ADS" });
  assert.deepEqual(((await r.json()) as { revoked: unknown }).revoked, { skipped: "shared-grant", revoked: [] });
  await call(secrets.DELETE, "DELETE", { name: "SEARCH", workspace: "desk" });
});

test("deleting revokes; a provider that is down is reported and the secret is gone anyway", async () => {
  const ok = await call(secrets.DELETE, "DELETE", { name: "CRM", workspace: "desk" });
  assert.deepEqual(((await ok.json()) as { revoked: unknown }).revoked, { revoked: ["refresh_token"] });
  assert.deepEqual(revoked.slice(-1), ["rt-new"]);

  await call(secrets.PUT, "PUT", { name: "CRM2", oauth2: recipe("rt-2") });
  mode = "down";
  const res = await call(secrets.DELETE, "DELETE", { name: "CRM2" });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { ok: boolean; revoked: { revoked: string[]; error?: string } };
  assert.equal(j.ok, true);
  assert.match(j.revoked.error ?? "", /refused to revoke the refresh token \(503/);
  assert.equal(listSecrets("acme").some((s) => s.name === "CRM2"), false, "deleted, whatever the provider said");
  mode = "ok";
});

test("a plain secret, or an oauth2 one with no revocation_url, answers no revoked at all / skipped", async () => {
  await call(secrets.PUT, "PUT", { name: "PLAIN", value: "v" });
  assert.equal(((await (await call(secrets.DELETE, "DELETE", { name: "PLAIN" })).json()) as { revoked?: unknown }).revoked, undefined);
  await call(secrets.PUT, "PUT", { name: "NO_URL", oauth2: { ...recipe("rt-x"), revocation_url: undefined } });
  assert.deepEqual(((await (await call(secrets.DELETE, "DELETE", { name: "NO_URL" })).json()) as { revoked?: unknown }).revoked, { skipped: "no-revocation-url", revoked: [] });
});
