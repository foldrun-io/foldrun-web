// A bad token at a public hook URL is anyone's to send, and it moved the
// workspace's deployedAt: that is the workspace directory's mtime, and the
// refusal was written by creating the delivery log, or by a tmp file renamed
// over it (FOL-102, found in the 26 Oct cross-tenant test). A refusal now
// leaves the workspace's record exactly as it was.
//
//   node --import ./tests/register.mjs --test tests/hook-refused-metadata.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-hook-refused-"));
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_TRUST_PROXY;
const { NextRequest } = await import("next/server");
const { POST } = await import("../app/api/hooks/[tenant]/[workspace]/[flow]/route.ts");
const { recordDelivery, readDeliveries } = await import("../../foldrun-core/src/webhook.ts");
const { listWorkspaces } = await import("../../foldrun-core/src/store.ts");

const LONG_AGO = new Date("2026-01-02T03:04:05.000Z");

function workspace(name: string): string {
  const dir = path.join(process.env.FOLDRUN_DATA!, "acme/workspaces", name);
  fs.mkdirSync(path.join(dir, "flows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${name}\n---\n`);
  fs.writeFileSync(path.join(dir, "flows/intake.md"), "---\ntrigger: webhook\n---\n");
  return dir;
}

const hit = (ws: string, flow: string, token: string) =>
  POST(
    new NextRequest(`http://x/api/hooks/acme/${ws}/${flow}?token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ tenant: "acme", workspace: ws, flow }) },
  );

const record = (ws: string) => listWorkspaces("acme").find((w) => w.name === ws);

async function quietly<T>(fn: (warnings: string[]) => Promise<T>): Promise<T> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    return await fn(warnings);
  } finally {
    console.warn = warn;
  }
}

test("a workspace no hook has reached: bad tokens leave deployedAt, the record and the directory alone", () =>
  quietly(async (warnings) => {
    const dir = workspace("fresh");
    fs.utimesSync(dir, LONG_AGO, LONG_AGO);
    const before = { record: record("fresh"), entries: fs.readdirSync(dir).sort() };
    assert.equal(before.record?.deployedAt, LONG_AGO.toISOString());

    for (const flow of ["intake", "intake", "made-up"]) assert.equal((await hit("fresh", flow, "wrong")).status, 401);

    assert.deepEqual(record("fresh"), before.record);
    assert.deepEqual(fs.readdirSync(dir).sort(), before.entries, "nothing created in the workspace");
    assert.equal(fs.statSync(dir).mtime.toISOString(), LONG_AGO.toISOString());
    // The refusal is not lost: one server line a minute per workspace.
    assert.equal(warnings.filter((w) => w.includes("acme/fresh")).length, 1);
    assert.match(warnings[0], /refused a delivery to acme\/fresh\/intake: invalid-token/);
  }));

test("a workspace with a delivery log: the refusals still show there, collapsed, and deployedAt does not move", () =>
  quietly(async () => {
    const dir = workspace("busy");
    recordDelivery("acme", "busy", { t: new Date().toISOString(), flow: "intake", outcome: "accepted", runId: "run-1" });
    fs.utimesSync(dir, LONG_AGO, LONG_AGO);
    const before = { record: record("busy"), entries: fs.readdirSync(dir).sort() };

    // The first refusal is appended, the rest fold into it in place.
    for (let i = 0; i < 25; i++) assert.equal((await hit("busy", i % 2 ? "intake" : "other", "wrong")).status, 401);

    assert.deepEqual(record("busy"), before.record);
    assert.deepEqual(fs.readdirSync(dir).sort(), before.entries, "no tmp file, no new file");
    assert.equal(fs.statSync(dir).mtime.toISOString(), LONG_AGO.toISOString());
    const [refused, real] = readDeliveries("acme", "busy", 5);
    assert.equal(refused.outcome, "invalid-token");
    assert.equal(refused.count, 25);
    assert.equal(refused.detail, "more than one flow name");
    assert.equal(real.runId, "run-1");
  }));
