// The agent PATCH route's frontmatter edits (canvas list and scalar edits,
// network:) are read back before they are written: an edit into a block
// the text writers do not handle is refused 409 with the file unchanged,
// and edits written one key per line land inside their block (Codex debate,
// 21 Oct 2026).
//
//   node --import ./tests/register.mjs --test tests/agent-frontmatter-guard.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-agent-guard-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; agent: string }> }) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/agents/[agent]/route.ts")) as unknown as { PATCH: Handler };

const TENANT = "acme";
const ws = path.join(DATA, TENANT, "workspaces", "desk");
const file = path.join(ws, "agents/w/agent.md");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
const { key } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const patch = (body: unknown) =>
  route.PATCH(
    new NextRequest("http://localhost/api/workspaces/desk/agents/w", { method: "PATCH", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ workspace: "desk", agent: "w" }) },
  );

test("network: into a block written one key per line is edited there; clearing it drops the block", async () => {
  fs.writeFileSync(file, "---\nname: w\ndescription: d\nguardrail:\n  network: none\n---\n\nWrites.\n");
  const r = await patch({ network: { level: "trusted", allow: ["api.example.com"] } });
  assert.equal(r.status, 200, await r.clone().text());
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /guardrail:\n {2}network:/);
  assert.equal((text.match(/network:/g) ?? []).length, 1);
  const cleared = await patch({ network: null });
  assert.equal(cleared.status, 200, await cleared.clone().text());
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /guardrail:|network:/);
});

test("a block the writers do not edit is refused 409 and the file is left as it was", async () => {
  const raw = "---\nname: w\ndescription: d\nguardrail: {\n  network: none\n}\n---\n\nWrites.\n";
  fs.writeFileSync(file, raw);
  const r = await patch({ network: { level: "open" } });
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal(fs.readFileSync(file, "utf8"), raw);
});

test("a list edit and a scalar edit read back as asked", async () => {
  fs.writeFileSync(file, "---\nname: w\ndescription: d\ntools: [read]\n---\n\nWrites.\n");
  const add = await patch({ list: { key: "tools", name: "web", action: "add" } });
  assert.equal(add.status, 200, await add.clone().text());
  assert.match(fs.readFileSync(file, "utf8"), /tools:.*read.*web|tools:\n(.*\n)*.*web/);
  const set = await patch({ set: { key: "description", value: "Writes the\nweekly digest: one page" } });
  assert.equal(set.status, 200, await set.clone().text());
  assert.match(fs.readFileSync(file, "utf8"), /description: "Writes the weekly digest: one page"/);
});

test("an agent file whose frontmatter does not parse is refused, not written over", async () => {
  const raw = "---\nname: w\ntools: [\n---\n\nWrites.\n";
  fs.writeFileSync(file, raw);
  const r = await patch({ list: { key: "tools", name: "web", action: "add" } });
  assert.equal(r.status, 409, await r.clone().text());
  assert.equal(fs.readFileSync(file, "utf8"), raw);
});

test("set sandbox: own | parent, and nothing else", async () => {
  fs.writeFileSync(file, "---\nname: w\ndescription: d\n---\n\nWrites.\n");
  const ok = await patch({ set: { key: "sandbox", value: "own" } });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.match(fs.readFileSync(file, "utf8"), /^sandbox: own$/m);
  const bad = await patch({ set: { key: "sandbox", value: "yes" } });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /sandbox is one of own, parent/);
  assert.match(fs.readFileSync(file, "utf8"), /^sandbox: own$/m, "a refused value leaves the file as it was");
});
