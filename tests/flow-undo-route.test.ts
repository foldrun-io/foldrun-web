// The canvas's undo and batch edits on PATCH …/flows/<flow>: every write
// answers with the file before and after it; { restore, expect } puts an
// earlier text back only while the file still reads `expect` (409 and the
// current text otherwise, the file untouched); { edits } applies several
// pattern edits as one write.
//
//   node --import ./tests/register.mjs --test tests/flow-undo-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-undo-route-"));
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
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const FLOW = `---
name: morning
---

1. [[researcher]] — find it
2. [[watchdog]] — stray drop
   retry: 2
3. [[writer]] — write it
4. [[editor]] — tighten it
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

type Wrote = { before: string; text: string; flow: { steps: { agent: string }[] } };

test("an edit answers with the text before and after it", async () => {
  const res = await patch({ edit: { op: "approve", step: 2, on: true } });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as Wrote;
  assert.equal(body.before, FLOW);
  assert.equal(body.text, fs.readFileSync(file, "utf8"));
  assert.match(body.text, /^3!\. \[\[writer\]\]/m);
});

test("restore puts the earlier text back while the file is what we last wrote", async () => {
  const now = fs.readFileSync(file, "utf8");
  const res = await patch({ restore: FLOW, expect: now });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as Wrote;
  assert.equal(body.before, now);
  assert.equal(body.text, FLOW);
  assert.equal(fs.readFileSync(file, "utf8"), FLOW);
});

test("restore is refused with 409 when the file changed since — and the file stays theirs", async () => {
  const theirs = FLOW.replace("find it", "find it, carefully");
  fs.writeFileSync(file, theirs);
  const res = await patch({ restore: "1. [[x]] — y\n", expect: FLOW });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { text: string; error: string };
  assert.equal(body.text, theirs);
  assert.equal(fs.readFileSync(file, "utf8"), theirs);
  const bad = await patch({ restore: FLOW });
  assert.equal(bad.status, 400, "restore without expect is refused");
  fs.writeFileSync(file, FLOW);
});

test("edits: several removals in one write (a selection deleted), highest index first", async () => {
  const res = await patch({ edits: [{ op: "remove", step: 3 }, { op: "remove", step: 1 }] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as Wrote;
  assert.deepEqual(body.flow.steps.map((s) => s.agent), ["researcher", "writer"]);
  assert.equal(body.before, FLOW);
  fs.writeFileSync(file, FLOW);
});

test("edits: one bad edit refuses the whole batch, the file unchanged", async () => {
  const res = await patch({ edits: [{ op: "remove", step: 3 }, { op: "remove", step: 9 }] });
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  assert.equal(fs.readFileSync(file, "utf8"), FLOW);
});

// An index-based edit from a stale view hit whichever step now had that
// index (audit, 2026-10-01). Every shape takes `expect` — the text, or its
// sha256 — and is refused with 409 when the file no longer reads it.
test("every index-based shape is refused with 409 when the file no longer reads `expect`", async () => {
  const { createHash } = await import("node:crypto");
  const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  const theirs = FLOW.replace("2. [[watchdog]] — stray drop\n   retry: 2\n", "").replace("3. [[writer]]", "2. [[writer]]").replace("4. [[editor]]", "3. [[editor]]");
  fs.writeFileSync(file, theirs);
  for (const body of [
    { edit: { op: "remove", step: 1 } },
    { edits: [{ op: "remove", step: 1 }] },
    { step: 1, options: { retry: 3 } },
    { step: 1, instruction: "x" },
    { groups: [[0], [2], [1]] },
  ]) {
    for (const expect of [FLOW, sha(FLOW)]) {
      const res = await patch({ ...body, expect });
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(((await res.json()) as { text: string }).text, theirs);
      assert.equal(fs.readFileSync(file, "utf8"), theirs, "nothing written");
    }
  }
  const ok = await patch({ edit: { op: "remove", step: 1 }, expect: sha(theirs) });
  assert.equal(ok.status, 200, await ok.clone().text());
  fs.writeFileSync(file, FLOW);
});
