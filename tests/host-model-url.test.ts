// A provider's base_url is fetched by the host (a draft, a judge, the
// assistant), so on a platform it may not be plain http or an internal
// address (FOL-95). Settings → Model refuses one when it is saved; a draft
// whose workspace's provider: block points inward is refused before any
// model call. On a laptop nothing changes: its own localhost is fine.
//
//   node --import ./tests/register.mjs --test tests/host-model-url.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-host-model-url-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DRAFT_MOCK;
delete process.env.FOLDRUN_EGRESS_ALLOW_PRIVATE;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const model = await import("../app/api/account/model/route.ts");
const draftRoute = (await import("../app/api/workspaces/[workspace]/flows/draft/route.ts")) as {
  POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
};
const { createApiKey } = await import("../server/auth.ts");
const { registerPlatform, platform } = await import("@/lib/platform");
const { getSecret } = await import("@/lib/secrets");

const { key: admin } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const h = { authorization: `Bearer ${admin}`, "content-type": "application/json" };
const put = (baseUrl: string) =>
  model.PUT(new NextRequest("http://x/api/account/model", { method: "PUT", headers: h, body: JSON.stringify({ provider: "custom", apiKey: "k-123456789", baseUrl }) }));

/** As a platform binds it: tenant URLs fetched through a guard. Undone after. */
async function guarded(fn: (asked: string[]) => Promise<void>) {
  const before = platform.fetchUntrusted;
  const asked: string[] = [];
  registerPlatform({ fetchUntrusted: (url, init) => (asked.push(url), fetch(url, init)) });
  try {
    await fn(asked);
  } finally {
    registerPlatform({ fetchUntrusted: before });
  }
}

test("on a platform, Settings → Model refuses an internal base URL, and stores nothing", () =>
  guarded(async () => {
    for (const url of ["https://127.0.0.1:3000", "https://10.43.0.1", "https://169.254.169.254/latest", "https://[::ffff:7f00:1]", "https://foldrun-postgres", "https://redis.foldrun.svc.cluster.local"]) {
      const res = await put(url);
      assert.equal(res.status, 400, url);
      assert.match((await res.json()).error, /baseUrl refused/, url);
      assert.equal(getSecret("acme", "FOLDRUN_MODEL_BASE_URL"), null, `${url}: nothing stored`);
    }
    assert.equal((await put("https://models.example.com/v1")).status, 200, "a public https endpoint is fine");
  }));

test("on a laptop the same route keeps its one rule (https), and an internal name is not its business", async () => {
  assert.equal((await put("https://localhost:11434")).status, 200);
});

test("a draft whose workspace's provider: block is plain http is refused on a platform before any model call", () =>
  guarded(async (asked) => {
    const ws = path.join(DATA, "acme", "workspaces", "desk");
    fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\nprovider:\n  base_url: http://foldrun-web:3000/api\n  format: anthropic\n  token: x\n---\n");
    const res = await draftRoute.POST(
      new NextRequest("http://localhost/api/workspaces/desk/flows/draft", { method: "POST", headers: h, body: JSON.stringify({ description: "a weekly digest" }) }),
      { params: Promise.resolve({ workspace: "desk" }) },
    );
    assert.equal(res.status, 422, await res.clone().text());
    assert.match((await res.json()).error, /base_url refused: http:\/\/foldrun-web:3000 is not https/);
    assert.deepEqual(asked, [], "nothing was fetched");
  }));
