// FOL-105: the routes that make a new file — agent, flow, eval, asset — and a
// workspace's settings PATCH wrote with no `by`, so history credited every one
// of them to "system". `foldrun agent new --platform` was how it was seen.
// Each now records the person the request came from, as /source always did.
//
//   node --import ./tests/register.mjs --test tests/create-attribution.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-create-by-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { listRevisions } = await import("@/lib/history");

type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const agents = (await import("../app/api/workspaces/[workspace]/agents/route.ts")) as { POST: Handler };
const flows = (await import("../app/api/workspaces/[workspace]/flows/route.ts")) as { POST: Handler };
const evals = (await import("../app/api/workspaces/[workspace]/evals/route.ts")) as { POST: Handler };
const workspace = (await import("../app/api/workspaces/[workspace]/route.ts")) as { PATCH: Handler };

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "agents"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const { key } = await createApiKey(TENANT, "laptop", "owner@acme.test", undefined, "admin");

const call = (h: Handler, method: string, route: string, body: unknown) =>
  h(
    new NextRequest(`http://localhost/api/workspaces/${WS}${route}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: WS }) },
  );

const byOf = (forPath: string) => listRevisions(TENANT, WS, { forPath, limit: 1 })[0]?.by;

test("a new agent, flow and eval, and a settings change, are credited to the key's person", async () => {
  const made = [
    [await call(agents.POST, "POST", "/agents", { name: "writer" }), "agents/writer/agent.md"],
    [await call(flows.POST, "POST", "/flows", { name: "morning" }), "flows/morning.md"],
    [await call(evals.POST, "POST", "/evals", { name: "house-style" }), "evals/house-style.md"],
    [await call(workspace.PATCH, "PATCH", "", { timezone: "UTC" }), "AGENTS.md"],
  ] as const;
  for (const [res, rel] of made) {
    assert.equal(res.status, 200, `${rel}: ${await res.clone().text()}`);
    assert.ok(fs.existsSync(path.join(ws, rel)), `${rel} was written`);
    assert.equal(byOf(rel), "owner@acme.test", `${rel} is credited to the person, not "system"`);
  }
});
