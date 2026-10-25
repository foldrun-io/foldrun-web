// A removal list confirmed from a dry run is sent back with the real deploy
// as expectRemoved; the route refuses 409 when the deploy would now remove
// anything outside it, and says what it would remove.
//
//   node --import ./tests/register.mjs --test tests/deploy-expect-removed.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-deploy-expect-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
const { NextRequest } = await import("next/server");
const { POST } = await import("../app/api/workspaces/[workspace]/deploy/route.ts");
const { createApiKey } = await import("../server/auth.ts");

const AGENT = "---\nname: writer\ndescription: writes things\n---\n\nWrite.\n";
const FLOW = "---\nname: publish\ntrigger: manual\n---\n\n1. [[writer]] — write it\n";
const files = (extra: Record<string, string> = {}) =>
  Object.entries({ "AGENTS.md": "---\nname: desk\n---\n\nA desk.\n", "agents/writer/agent.md": AGENT, "flows/publish.md": FLOW, ...extra })
    .map(([p, content]) => ({ path: p, content }));

const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const deploy = (body: object) =>
  POST(
    new NextRequest("http://x/api/workspaces/desk/deploy", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: "desk" }) },
  );
const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");

test("a removal nobody confirmed is refused 409 with the new list; nothing changes", async () => {
  assert.equal((await deploy({ files: files({ "flows/old.md": FLOW }) })).status, 200);
  const dry = await (await deploy({ files: files(), dryRun: true })).json();
  assert.deepEqual(dry.removed, ["flows/old.md"]);

  // someone adds a source file between the question and the deploy
  fs.writeFileSync(path.join(ws, "flows/added-meanwhile.md"), FLOW);

  const res = await deploy({ files: files(), expectRemoved: dry.removed });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.removed, ["flows/added-meanwhile.md", "flows/old.md"]);
  assert.deepEqual(body.unexpectedRemovals, ["flows/added-meanwhile.md"]);
  assert.ok(fs.existsSync(path.join(ws, "flows/added-meanwhile.md")));
  assert.ok(fs.existsSync(path.join(ws, "flows/old.md")));

  const again = await deploy({ files: files(), expectRemoved: body.removed });
  assert.equal(again.status, 200);
  assert.ok(!fs.existsSync(path.join(ws, "flows/old.md")));
});

test("expectRemoved must be an array of strings", async () => {
  assert.equal((await deploy({ files: files(), expectRemoved: "flows/old.md" })).status, 400);
  assert.equal((await deploy({ files: files(), expectRemoved: [1] })).status, 400);
});
