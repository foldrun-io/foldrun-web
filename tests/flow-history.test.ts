// The flow history drawer: its diff model, and the restore it performs —
// GET the file (with its sha256), GET a revision, PUT that revision's bytes
// back with ifMatch. A restore writes exactly the old bytes and leaves a
// revision saying so; a file that changed since the drawer loaded is
// refused with 409 and left alone.
//
//   node --import ./tests/register.mjs --test tests/flow-history.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flow-history-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { lineDiff, foldDiff, diffStats, restoreMessage } = await import("../components/flow-history-model.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const source = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as { GET: Handler; PUT: Handler };
const history = (await import("../app/api/workspaces/[workspace]/history/route.ts")) as { GET: Handler };

// ---------------------------------------------------------------- model

test("lineDiff keeps, deletes and adds by line, and agrees with the texts", () => {
  const ops = lineDiff("a\nb\nc\n", "a\nB\nc\nd\n");
  assert.deepEqual(ops, [
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "same", text: "c" },
    { kind: "add", text: "d" },
  ]);
  assert.deepEqual(diffStats(ops), { added: 2, removed: 1 });
  // Rebuilding either side from the ops gives the side back.
  const before = ops.filter((o) => o.kind !== "add").map((o) => o.text).join("\n");
  const after = ops.filter((o) => o.kind !== "del").map((o) => o.text).join("\n");
  assert.equal(before, "a\nb\nc");
  assert.equal(after, "a\nB\nc\nd");
  assert.deepEqual(lineDiff("", "x"), [{ kind: "add", text: "x" }]);
});

test("foldDiff numbers both sides and folds unchanged stretches beyond the context", () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace("line 10", "line ten");
  const rows = foldDiff(lineDiff(before, after), 2);
  assert.deepEqual(rows[0], { kind: "gap", count: 7 });
  assert.deepEqual(rows.slice(1, 3).map((r) => r.kind === "gap" ? r : [r.oldNo, r.newNo]), [[8, 8], [9, 9]]);
  assert.deepEqual(rows[3], { kind: "del", text: "line 10", oldNo: 10, newNo: null });
  assert.deepEqual(rows[4], { kind: "add", text: "line ten", oldNo: null, newNo: 10 });
  assert.deepEqual(rows[rows.length - 1], { kind: "gap", count: 8 });
  // A fold of one line is just shown.
  const short = foldDiff(lineDiff("a\nb\nc\nd", "a\nb\nc\nD"), 2);
  assert.equal(short.some((r) => r.kind === "gap"), false);
  // Nothing changed, nothing to draw.
  assert.deepEqual(foldDiff(lineDiff("same\n", "same\n")), []);
});

test("a restore says which revision it brought back", () => {
  assert.equal(restoreMessage({ id: "20260930-abc", commit: null }), "restored 20260930-abc from history");
  assert.equal(restoreMessage({ id: "x", commit: "0123456789abcdef" }), "restored 0123456 from history");
});

// ---------------------------------------------------------------- routes

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\n---\n\nWrite.\n");
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const ctx = { params: Promise.resolve({ workspace: WS }) };
const req = (url: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost/api/workspaces/${WS}/${url}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const V1 = "---\nname: publish\n---\n\n1. [[writer]] — Write it.\n";
const V2 = "---\nname: publish\n---\n\n1. [[writer]] — Write it twice.\n   retry: 2\n";
const FILE = "flows/publish.md";

test("restore writes the old revision's exact bytes, as a new revision", async () => {
  assert.equal((await source.PUT(req("source", { method: "PUT", body: { path: FILE, content: V1, message: "first" } }), ctx)).status, 200);
  assert.equal((await source.PUT(req("source", { method: "PUT", body: { path: FILE, content: V2, message: "second" } }), ctx)).status, 200);

  const list = (await (await history.GET(req(`history?path=${encodeURIComponent(FILE)}`), ctx)).json()) as { revisions: { id: string; message: string }[] };
  // With git, the first write is also the repository's initial import.
  assert.equal(list.revisions[0].message, "second");
  assert.match(list.revisions[1].message, /first$/);
  const first = list.revisions[1];

  const rev = (await (await history.GET(req(`history?id=${encodeURIComponent(first.id)}&path=${encodeURIComponent(FILE)}`), ctx)).json()) as {
    id: string; commit: string | null; files: { after: string }[];
  };
  assert.equal(rev.files[0].after, V1);

  const cur = (await (await source.GET(req(`source?path=${encodeURIComponent(FILE)}`), ctx)).json()) as { content: string; sha256: string };
  assert.equal(cur.content, V2);
  assert.match(cur.sha256, /^[0-9a-f]{64}$/);

  const res = await source.PUT(
    req("source", { method: "PUT", body: { path: FILE, content: rev.files[0].after, message: restoreMessage(rev), ifMatch: cur.sha256 } }),
    ctx,
  );
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(fs.readFileSync(path.join(ws, FILE), "utf8"), V1);
  const after = (await (await history.GET(req(`history?path=${encodeURIComponent(FILE)}`), ctx)).json()) as { revisions: { message: string }[] };
  assert.equal(after.revisions[0].message, restoreMessage(rev));
});

test("a restore against a file that changed since it was loaded is refused, and writes nothing", async () => {
  const cur = (await (await source.GET(req(`source?path=${encodeURIComponent(FILE)}`), ctx)).json()) as { sha256: string };
  assert.equal(fs.readFileSync(path.join(ws, FILE), "utf8"), V1);
  // Someone else saves in between.
  await source.PUT(req("source", { method: "PUT", body: { path: FILE, content: V2, message: "someone else" } }), ctx);
  const res = await source.PUT(req("source", { method: "PUT", body: { path: FILE, content: V1, message: "restore", ifMatch: cur.sha256 } }), ctx);
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /changed since it was loaded/);
  assert.equal(fs.readFileSync(path.join(ws, FILE), "utf8"), V2);
});

test("a write without ifMatch is unchanged behaviour", async () => {
  const res = await source.PUT(req("source", { method: "PUT", body: { path: FILE, content: V1 } }), ctx);
  assert.equal(res.status, 200);
  assert.equal(fs.readFileSync(path.join(ws, FILE), "utf8"), V1);
});
