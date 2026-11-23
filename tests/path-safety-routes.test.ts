// Path-safety property tests through the real routes: a hostile name in a
// query string, a JSON body or a path parameter is a clean 4xx (or a normal
// answer), never a 500, never bytes from outside the workspace, never a file
// made or changed outside it. Seeded (core's generator), no network, no model.
//
//   node --import ./tests/register.mjs --test tests/path-safety-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostile } from "../../foldrun-core/tests/path-safety-gen.ts";

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ps-routes-"));
const DATA = path.join(BASE, "data");
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Ctx = { params: Promise<Record<string, string>> };
type H = (req: InstanceType<typeof NextRequest>, ctx: Ctx) => Promise<Response>;
const mod = async (p: string) => (await import(p)) as Record<string, H>;
const source = await mod("../app/v1/workspaces/[workspace]/source/route.ts");
const storage = await mod("../app/v1/workspaces/[workspace]/storage/route.ts");
const download = await mod("../app/v1/workspaces/[workspace]/storage/download/route.ts");
const archive = await mod("../app/v1/workspaces/[workspace]/runs/[runId]/archive/route.ts");
const calls = await mod("../app/v1/workspaces/[workspace]/runs/[runId]/calls/[callId]/route.ts");
const library = await mod("../app/v1/library/[kind]/route.ts");
const avatars = await mod("../app/v1/avatars/[kind]/[id]/route.ts");

const TENANT = "acme";
const WS = "desk";
const RUN = "run-pathsafe";
const ws = path.join(DATA, TENANT, "workspaces", WS);
const outside = path.join(BASE, "outside");
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(outside, "secret.md"), "outside-secret\n");
fs.mkdirSync(path.join(ws, "knowledge"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const out = path.join(ws, "runs", RUN, "outputs", "writer");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ws, "runs", `${RUN}.json`), JSON.stringify({ id: RUN, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [] }));
fs.writeFileSync(path.join(out, "report.md"), "# report\n");
fs.mkdirSync(path.join(ws, "runs", RUN, "calls"), { recursive: true });
fs.writeFileSync(path.join(ws, "runs", RUN, "calls", "call-1.json"), JSON.stringify({ id: "call-1", tool: "x" }));

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const params = (p: Record<string, string>): Ctx => ({ params: Promise.resolve(p) });
const url = (p: string, q: Record<string, string> = {}) => `http://localhost${p}?${new URLSearchParams(q)}`;

function snapshot(dir: string): string {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return "";
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = path.join(e.parentPath, e.name);
    out.push(`${path.relative(dir, p)}:${e.isFile() ? fs.readFileSync(p, "utf8") : "-"}`);
  }
  return out.sort().join("\n");
}
const fine = async (label: string, res: Response) => {
  const text = await res.text();
  assert.ok(res.status < 500, `${label} -> ${res.status}: ${text.slice(0, 200)}`);
  assert.ok(!text.includes("outside-secret"), `${label} returned bytes from outside`);
  return { status: res.status, text };
};

// Lone surrogates and U+10FFFF are refused by macOS itself (EILSEQ); a Linux disk takes them.
const NAMES = hostile(41, 260).filter((n) => n.isWellFormed() && !n.includes("\u{10FFFF}"));

test("source routes (GET, PUT, PATCH rename, DELETE): hostile paths are refused or normal, never a 500, nothing outside the workspace changes", async () => {
  const before = snapshot(outside);
  const c = params({ workspace: WS });
  let okWrites = 0;
  for (const rel of NAMES) {
    for (const p of [rel, `agents/${rel}`, `knowledge/${rel}`]) {
      await fine(`GET ${p}`, await source.GET(new NextRequest(url(`/v1/workspaces/${WS}/source`, { path: p }), { headers }), c));
      const put = await fine(`PUT ${p}`, await source.PUT(new NextRequest(url(`/v1/workspaces/${WS}/source`), { method: "PUT", headers, body: JSON.stringify({ path: p, content: "---\nname: t\n---\nhi\n" }) }), c));
      if (put.status === 200) {
        okWrites++;
        // a name the writer took, the reader and delete take
        const got = await fine(`GET-after-PUT ${p}`, await source.GET(new NextRequest(url(`/v1/workspaces/${WS}/source`, { path: p }), { headers }), c));
        assert.equal(got.status, 200, `reader refused what the writer took: ${JSON.stringify(p)}`);
        await fine(`PATCH ${p}`, await source.PATCH(new NextRequest(url(`/v1/workspaces/${WS}/source`), { method: "PATCH", headers, body: JSON.stringify({ from: p, to: `knowledge/moved-${okWrites}.md` }) }), c));
        await fine(`DELETE ${p}`, await source.DELETE(new NextRequest(url(`/v1/workspaces/${WS}/source`), { method: "DELETE", headers, body: JSON.stringify({ path: p }) }), c));
      }
      await fine(`DELETE-raw ${p}`, await source.DELETE(new NextRequest(url(`/v1/workspaces/${WS}/source`), { method: "DELETE", headers, body: JSON.stringify({ path: p }) }), c));
    }
  }
  assert.ok(okWrites > 10, String(okWrites));
  assert.equal(snapshot(outside), before);
  assert.deepEqual(fs.readdirSync(path.join(DATA, TENANT, "workspaces")), [WS], "no workspace was made by a path");
});

test("file store routes: hostile names are refused or normal; an uploaded name downloads, lists and deletes as itself", async () => {
  const c = params({ workspace: WS });
  let stored = 0;
  for (const rel of NAMES) {
    const raw = await storage.PUT(new NextRequest(url(`/v1/workspaces/${WS}/storage`, { path: rel }), { method: "PUT", headers: { authorization: headers.authorization, "content-length": "5" }, body: "bytes" }), c);
    const put = await fine(`PUT ${rel}`, raw);
    if (put.status === 200) {
      stored++;
      const body = JSON.parse(put.text).file.path as string;
      const dl = await fine(`download ${rel}`, await download.GET(new NextRequest(url(`/v1/workspaces/${WS}/storage/download`, { path: rel }), { headers }), c));
      assert.equal(dl.status, 200, `download refused what upload took: ${JSON.stringify(rel)}`);
      const del = await fine(`DELETE ${rel}`, await storage.DELETE(new NextRequest(url(`/v1/workspaces/${WS}/storage`, { path: body }), { method: "DELETE", headers }), c));
      assert.equal(del.status, 200, `delete refused what upload took: ${JSON.stringify(rel)}`);
    } else {
      await fine(`download-refused ${rel}`, await download.GET(new NextRequest(url(`/v1/workspaces/${WS}/storage/download`, { path: rel }), { headers }), c));
    }
  }
  assert.ok(stored > 20, String(stored));
});

test("run archive, calls and library routes: hostile agent, path, call id and library names never 500 or read outside", async () => {
  const before = snapshot(outside);
  const c = params({ workspace: WS, runId: RUN });
  for (const n of NAMES) {
    await fine(`archive agent=${n}`, await archive.GET(new NextRequest(url(`/v1/workspaces/${WS}/runs/${RUN}/archive`, { agent: n, path: "report.md" }), { headers }), c));
    const r = await fine(`archive path=${n}`, await archive.GET(new NextRequest(url(`/v1/workspaces/${WS}/runs/${RUN}/archive`, { agent: "writer", path: n }), { headers }), c));
    assert.ok(r.status === 404 || r.status === 400 || r.status === 200, `archive path ${JSON.stringify(n)} -> ${r.status}`);
    await fine(`call ${n}`, await calls.GET(new NextRequest(`http://localhost/v1/workspaces/${WS}/runs/${RUN}/calls/${encodeURIComponent(n)}`, { headers }), params({ workspace: WS, runId: RUN, callId: n })));
    await fine(`library get ${n}`, await library.GET(new NextRequest(url("/v1/library/knowledge", { path: n }), { headers }), params({ kind: "knowledge" })));
    const w = await fine(`library put ${n}`, await library.PUT(new NextRequest(url("/v1/library/knowledge"), { method: "PUT", headers, body: JSON.stringify({ path: n, content: "---\nname: t\n---\nhi\n" }) }), params({ kind: "knowledge" })));
    if (w.status === 200) {
      const g = await fine(`library get-after-put ${n}`, await library.GET(new NextRequest(url("/v1/library/knowledge", { path: n }), { headers }), params({ kind: "knowledge" })));
      assert.equal(g.status, 200, `reader refused what the writer took: ${JSON.stringify(n)}`);
      await fine(`library delete ${n}`, await library.DELETE(new NextRequest(url("/v1/library/knowledge"), { method: "DELETE", headers, body: JSON.stringify({ path: n }) }), params({ kind: "knowledge" })));
    }
    await fine(`library kind=${n}`, await library.GET(new NextRequest(url(`/v1/library/${encodeURIComponent(n)}`), { headers }), params({ kind: n })));
    await fine(`avatar id=${n}`, await avatars.GET(new NextRequest(`http://localhost/v1/avatars/user/${encodeURIComponent(n)}`, { headers }), params({ kind: "user", id: n })));
  }
  // the call that exists is readable, by its own id
  assert.equal((await calls.GET(new NextRequest(`http://localhost/x`, { headers }), params({ workspace: WS, runId: RUN, callId: "call-1" }))).status, 200);
  assert.equal(snapshot(outside), before);
});
