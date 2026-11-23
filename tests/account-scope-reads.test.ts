// A caller scoped to some workspaces — a member or a key handed to one desk —
// neither reads the other workspaces' setup through an account route nor
// changes what every workspace shares (30 Oct 2026):
//   - GET /v1/account/providers names only the account's provider blocks
//     and its own workspaces', and POST (a paid check of every workspace's
//     credentials) needs every workspace;
//   - PATCH /v1/account/api (the version pin every key gets) needs every
//     workspace.
//
//   node --import ./tests/register.mjs --test tests/account-scope-reads.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-scope-reads-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const files: Record<string, string> = {
  "acme/AGENTS.md": "---\nname: acme\nprovider:\n  base_url: https://gw.example.com\n  token: ${GW}\n---\n",
  "acme/workspaces/mine/AGENTS.md": "---\nname: mine\n---\n",
  "acme/workspaces/mine/agents/a/agent.md": "---\nname: a\nprovider:\n  base_url: https://mine.example.com\n  token: ${MINE}\n---\n",
  "acme/workspaces/secret-desk/AGENTS.md": "---\nname: secret-desk\nprovider:\n  base_url: https://hidden-gateway.example.com\n  token: ${HIDDEN}\n---\n",
  "acme/workspaces/secret-desk/agents/b/agent.md": "---\nname: b\nprovider:\n  base_url: https://other.example.com\n  token: ${OTHER}\n---\n",
};
for (const [p, body] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(DATA, p)), { recursive: true });
  fs.writeFileSync(path.join(DATA, p), body);
}

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const providersRoute = await import("../app/v1/account/providers/route.ts");
const apiRoute = await import("../app/v1/account/api/route.ts");

const { key: everyWs } = await createApiKey("acme", "all", "admin@acme.test", undefined, "admin");
const { key: oneWs } = await createApiKey("acme", "one desk", "desk@acme.test", undefined, "admin", ["mine"]);

const call = (key: string, url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

test("GET /v1/account/providers: a scoped caller sees the account's blocks and its own workspaces', not the others'", async () => {
  const all = (await (await providersRoute.GET(call(everyWs, "/v1/account/providers"))).json()) as { configured: { declaredIn: string }[] };
  assert.deepEqual(all.configured.map((c) => c.declaredIn).sort(), ["account", "mine/a", "secret-desk", "secret-desk/b"]);
  const res = await providersRoute.GET(call(oneWs, "/v1/account/providers"));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.doesNotMatch(text, /secret-desk|hidden-gateway|other\.example/);
  const scoped = JSON.parse(text) as { configured: { declaredIn: string }[] };
  assert.deepEqual(scoped.configured.map((c) => c.declaredIn).sort(), ["account", "mine/a"]);
});

test("POST /v1/account/providers (a paid check of every workspace) and PATCH /v1/account/api (every key's pin) need every workspace", async () => {
  const check = await providersRoute.POST(call(oneWs, "/v1/account/providers", "POST", {}));
  assert.equal(check.status, 403);
  const pin = await apiRoute.PATCH(call(oneWs, "/v1/account/api", "PATCH", { version: null }));
  assert.equal(pin.status, 403);
  assert.match(((await pin.json()) as { error: string }).error, /shared by every workspace/);
});
