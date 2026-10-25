// POST …/flows/draft with the model mocked: a good answer comes back as
// files that pass the deploy check; a bad one is shown its problems once
// and repaired, and whatever is still wrong is returned beside the files.
// Nothing is written to the workspace by a draft, whatever the model says,
// and a viewer's key is refused before any model is called.
//
//   node --import ./tests/register.mjs --test tests/flow-draft-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flow-draft-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DRAFT_MOCK;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const draft = await import("../server/flow-draft.ts");
const route = (await import("../app/api/workspaces/[workspace]/flows/draft/route.ts")) as {
  POST: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
};
const source = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as {
  PUT: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/researcher"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "agents/researcher/agent.md"), "---\nname: researcher\ndescription: Finds sources.\n---\n\nFind sources.\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: Writes drafts.\n---\n\nWrite.\n");
const EXISTING = "---\nname: publish\n---\n\n1. [[writer]] — Write it.\n";
fs.writeFileSync(path.join(ws, "flows/publish.md"), EXISTING);

const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const ctx = { params: Promise.resolve({ workspace: WS }) };
const post = (body: unknown, key = editor) =>
  route.POST(
    new NextRequest(`http://localhost/api/workspaces/${WS}/flows/draft`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );

/** A snapshot of every file in the workspace, to prove a draft wrote none. */
const snapshot = () => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(ws, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(ws);
  return out;
};

const GOOD = `<file path="flows/digest.md">
---
name: digest
trigger: manual
---

1. [[researcher]] — Find this week's sources.
2. [[checker]] — Check each claim against its source.
   verify: judge: every claim names its source
3. [[writer]] — Write the digest.
</file>
<file path="agents/checker/agent.md">
---
name: checker
description: Checks claims against sources.
---

You check each claim against the source it cites.
</file>
<notes>Adds one agent, checker.</notes>`;

// Names an agent nobody wrote, and a verify that is a sentence, not a shell
// command — both errors the deploy check / flow lint catch.
const BAD = `<file path="flows/digest.md">
---
name: digest
---

1. [[researcher]] — Find sources.
2. [[ghost]] — Haunt them.
   verify: the reply names the file it wrote
</file>`;

type Calls = { prompt: string }[];
function mock(answers: string[]): Calls {
  const calls: Calls = [];
  draft.setDraftCompleter(async ({ prompt, maxOutputTokens }) => {
    assert.equal(maxOutputTokens, draft.DRAFT_LIMITS.outputTokens);
    calls.push({ prompt });
    return { text: answers[Math.min(calls.length - 1, answers.length - 1)], costUsd: 0, supply: "mock" };
  });
  return calls;
}

test("a good answer: files with their current text, no issues, one model call, nothing written", async () => {
  const before = snapshot();
  const calls = mock([GOOD]);
  const res = await post({ description: "a weekly digest with a fact check" });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { ok: boolean; files: { path: string; content: string; before: string | null }[]; issues: unknown[]; repaired: boolean; notes: string };
  assert.equal(body.ok, true, JSON.stringify(body.issues));
  assert.deepEqual(body.files.map((f) => [f.path, f.before]), [["flows/digest.md", null], ["agents/checker/agent.md", null]]);
  assert.match(body.files[0].content, /\[\[checker\]\]/);
  assert.deepEqual(body.issues, []);
  assert.equal(body.repaired, false);
  assert.equal(body.notes, "Adds one agent, checker.");
  assert.equal(calls.length, 1);
  // The prompt carries the grammar, the workspace's agents and the request.
  assert.match(calls[0].prompt, /The number is the GROUP/);
  assert.match(calls[0].prompt, /- researcher: Finds sources\./);
  assert.match(calls[0].prompt, /a weekly digest with a fact check/);
  assert.deepEqual(snapshot(), before);
});

test("a bad answer is shown its problems once; a repaired answer comes back clean", async () => {
  const calls = mock([BAD, GOOD]);
  const res = await post({ description: "a digest" });
  const body = (await res.json()) as { ok: boolean; repaired: boolean; issues: unknown[] };
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /# Repair/);
  assert.match(calls[1].prompt, /\[\[ghost\]\] does not exist/);
  assert.equal(body.repaired, true);
  assert.equal(body.ok, true);
  assert.deepEqual(body.issues, []);
});

test("still bad after the one repair: the files and the remaining issues, and no third call", async () => {
  const before = snapshot();
  const calls = mock([BAD, BAD]);
  const res = await post({ description: "a digest" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; repaired: boolean; files: { path: string }[]; issues: { where: string; message: string; level: string }[] };
  assert.equal(calls.length, 2);
  assert.equal(body.ok, false);
  assert.equal(body.repaired, true);
  assert.deepEqual(body.files.map((f) => f.path), ["flows/digest.md"]);
  assert.ok(body.issues.some((i) => i.level === "error" && /ghost/.test(i.message)), JSON.stringify(body.issues));
  assert.ok(body.issues.some((i) => /verify/.test(i.message)), JSON.stringify(body.issues));
  assert.deepEqual(snapshot(), before);
});

test("files outside flows/ and agents/, and overwriting an existing agent, are problems — never written", async () => {
  const before = snapshot();
  mock([`${GOOD}\n<file path="secrets.json">{}</file>\n<file path="agents/writer/agent.md">\n---\nname: writer\n---\n\nRewritten.\n</file>`]);
  const body = (await (await post({ description: "x" })).json()) as { files: { path: string }[]; issues: { where: string; message: string }[] };
  assert.equal(body.files.some((f) => f.path === "secrets.json"), false);
  assert.ok(body.issues.some((i) => i.where === "secrets.json"));
  assert.ok(body.issues.some((i) => i.where === "agents/writer/agent.md" && /already exists/.test(i.message)));
  assert.deepEqual(snapshot(), before);
});

test("redrafting a flow returns its current text, and a save is the separate, explicit source PUT", async () => {
  const redraft = GOOD.replace(/flows\/digest\.md/, "flows/publish.md").replace("name: digest", "name: publish");
  const calls = mock([redraft]);
  const body = (await (await post({ description: "add a fact check", flow: "publish" })).json()) as {
    ok: boolean; files: { path: string; content: string; before: string | null; sha256: string | null }[];
  };
  assert.match(calls[0].prompt, /Rewrite flows\/publish\.md/);
  assert.equal(body.ok, true);
  const flow = body.files.find((f) => f.path === "flows/publish.md")!;
  assert.equal(flow.before, EXISTING);
  assert.equal(fs.readFileSync(path.join(ws, "flows/publish.md"), "utf8"), EXISTING);
  // Only the save writes, and it holds the server to the text the draft saw.
  const put = await source.PUT(
    new NextRequest(`http://localhost/api/workspaces/${WS}/source`, {
      method: "PUT",
      headers: { authorization: `Bearer ${editor}`, "content-type": "application/json" },
      body: JSON.stringify({ path: flow.path, content: flow.content, message: "drafted with AI", ifMatch: flow.sha256 }),
    }),
    ctx,
  );
  assert.equal(put.status, 200);
  assert.equal(fs.readFileSync(path.join(ws, "flows/publish.md"), "utf8"), flow.content);
});

test("a viewer's key is refused before any model call; an over-long description is refused", async () => {
  const calls = mock([GOOD]);
  const res = await post({ description: "a digest" }, viewer);
  assert.equal(res.status, 403);
  const long = await post({ description: "x".repeat(draft.DRAFT_LIMITS.description + 1) });
  assert.equal(long.status, 413);
  assert.equal(calls.length, 0);
});

test("the prompt stays under its cap however many agents the workspace has", () => {
  const p = draft.draftPrompt({
    description: "d",
    workspace: WS,
    agents: Array.from({ length: 2000 }, (_, i) => ({ name: `agent-${i}`, description: "x".repeat(200), tools: [] })),
    flows: [],
    current: null,
  });
  assert.ok(p.length <= draft.DRAFT_LIMITS.prompt, String(p.length));
  assert.match(p, /# What the person asked for/);
});

// Over the cap with no agents left to drop, the prompt recursed until the
// stack ran out (audit, 2026-10-01): a redraft (12k of current flow) that
// needed a repair (20k of previous answer) with a full description is over
// 40k on its own. And the cut that followed sliced off the end — the answer
// format and the repair instructions. The flow list and the quoted files give
// way instead; the instructions never do.
test("the prompt stays under its cap with no agents to drop, and keeps its instructions", () => {
  const ctx = {
    description: "d".repeat(draft.DRAFT_LIMITS.description),
    workspace: WS,
    agents: [],
    flows: Array.from({ length: 1500 }, (_, i) => `flow-number-${i}`),
    current: { path: "flows/big.md", content: "c".repeat(20_000) },
  };
  const repair = { previous: "p".repeat(30_000), issues: [{ where: "flows/big.md", message: "step 2: no such agent", level: "error" as const }] };
  const p = draft.draftPrompt(ctx, repair);
  assert.ok(p.length <= draft.DRAFT_LIMITS.prompt, String(p.length));
  assert.match(p, /# What the person asked for/);
  assert.match(p, /<file path="flows\/example.md">/);
  assert.match(p, /step 2: no such agent/);
  assert.match(p, /Answer again with every file, fixed\.$/);
});

// A "(new)" file was saved with no precondition (audit, 2026-10-01): a file
// created at that path after the draft was made was overwritten. ifMatch:
// null now means "expect no file there".
test("a draft's new file is saved with ifMatch: null, refused once someone created it meanwhile", async () => {
  const put = (p: string, content: string) =>
    source.PUT(
      new NextRequest(`http://localhost/api/workspaces/${WS}/source`, {
        method: "PUT",
        headers: { authorization: `Bearer ${editor}`, "content-type": "application/json" },
        body: JSON.stringify({ path: p, content, ifMatch: null }),
      }),
      ctx,
    );
  const fresh = await put("agents/brand-new/agent.md", "---\nname: brand-new\n---\n\nYou write.\n");
  assert.equal(fresh.status, 200);
  const again = await put("agents/brand-new/agent.md", "---\nname: brand-new\n---\n\nOverwritten.\n");
  assert.equal(again.status, 409);
  assert.match(fs.readFileSync(path.join(ws, "agents/brand-new/agent.md"), "utf8"), /You write\./);
});
