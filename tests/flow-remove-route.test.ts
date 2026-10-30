// The canvas's delete-a-step: PATCH …/flows/<flow> { edit: { op: "remove" } }
// removes the step line and its options through core's removeStep, renumbers
// the groups, never touches the agent file, and an unknown step is a 4xx
// with the file unchanged.
//
//   node --import ./tests/register.mjs --test tests/flow-remove-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-remove-step-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const route = (await import("../app/api/workspaces/[workspace]/flows/[flow]/route.ts")) as {
  PATCH: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; flow: string }> }) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/watchdog"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const AGENT = "---\nname: watchdog\n---\n\nYou watch.\n";
fs.writeFileSync(path.join(ws, "agents/watchdog/agent.md"), AGENT);
const FLOW = `---
name: morning
---

1. [[researcher]] — find it
2. [[watchdog]] — stray drop
   retry: 2
3. [[writer]] — write it
`;
const file = path.join(ws, "flows/morning.md");
fs.writeFileSync(file, FLOW);
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");

const patch = (body: unknown) =>
  route.PATCH(
    new NextRequest(`http://localhost/api/workspaces/${WS}/flows/morning`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: WS, flow: "morning" }) },
  );

test("an unknown step is refused and the file is unchanged", async () => {
  const res = await patch({ edit: { op: "remove", step: 7 } });
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  assert.equal(fs.readFileSync(file, "utf8"), FLOW);
});

test("remove: the step and its options go, the groups renumber, the agent file stays", async () => {
  const res = await patch({ edit: { op: "remove", step: 1 } });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { flow: { steps: { agent: string; group: number }[] } };
  assert.deepEqual(body.flow.steps.map((s) => `${s.group}:${s.agent}`), ["1:researcher", "2:writer"]);
  const out = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(out, /watchdog|retry: 2/);
  assert.match(out, /^2\. \[\[writer\]\] — write it$/m);
  assert.equal(fs.readFileSync(path.join(ws, "agents/watchdog/agent.md"), "utf8"), AGENT);
});

test("DELETE { step } is the same edit: prose after the last step survives", async () => {
  const del = route as unknown as { DELETE: typeof route.PATCH };
  fs.writeFileSync(file, `${FLOW}\nNotes below stay.\n`);
  const res = await del.DELETE(
    new NextRequest(`http://localhost/api/workspaces/${WS}/flows/morning`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ step: 2 }),
    }),
    { params: Promise.resolve({ workspace: WS, flow: "morning" }) },
  );
  assert.equal(res.status, 200, await res.clone().text());
  const out = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(out, /\[\[writer\]\]/);
  assert.match(out, /Notes below stay\./);
});

test("an edits list past the cap is refused before any is applied (30 Oct 2026)", async () => {
  const before = fs.readFileSync(file, "utf8");
  const res = await patch({ edits: Array.from({ length: 201 }, () => ({ op: "remove", step: 1 })) });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /at most 200 edits/);
  assert.equal(fs.readFileSync(file, "utf8"), before, "nothing written");
});
