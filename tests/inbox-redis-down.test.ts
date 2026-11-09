// FOL-134: open questions live in Redis. When they cannot be read — Redis
// down, or still coming up — the inbox still answers, with every gate it has
// from the run records, rather than failing the whole page.
//
//   node --import ./tests/register.mjs --test tests/inbox-redis-down.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// A port nothing listens on: every connection is refused.
const port = await new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});
process.env.FOLDRUN_REDIS_URL = `redis://127.0.0.1:${port}`;
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-inbox-redis-"));
process.env.FOLDRUN_HISTORY = "journal";
const { inboxFor } = await import("../server/inbox.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const { cache } = await import("../../foldrun-platform/src/cache.ts");

const ANA = "ana@acme.test";
const ws = path.join(process.env.FOLDRUN_DATA!, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\n---\n\nWrite.\n");
fs.writeFileSync(path.join(ws, "flows/publish.md"), `---\nname: publish\napprovers: [${ANA}]\n---\n\n1!. [[writer]] — Publish.\n`);
const at = new Date().toISOString();
writeRun("acme", "desk", {
  id: "run-gate",
  flow: "publish",
  status: "awaiting-approval",
  startedAt: at,
  finishedAt: null,
  startedBy: null,
  steps: [{ agent: "writer", instruction: "publish it", group: 1, optional: false, status: "awaiting-approval", events: [], result: null, costUsd: 0, waitingSince: at }],
} as never);

test("the inbox answers with its gates when the questions store cannot be read", async () => {
  try {
    const view = await inboxFor("acme", ANA, null, { role: "owner" });
    assert.deepEqual(view.items.map((i) => i.id), ["gate:desk/run-gate/0"]);
    assert.equal(view.items[0].bucket, "mine");
  } finally {
    cache()?.disconnect();
  }
});
