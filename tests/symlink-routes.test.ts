// FOL-83, through the routes: a symlink planted in a workspace no longer
// leads GET/PUT /source or the run archive out of it. Live check on a local
// server, 29 Oct: GET read a file outside, PUT overwrote one and created
// another through a linked folder, and the archive served one. The checks
// themselves are core's (store.ts landsInside); this pins what a caller sees.
//
//   node --import ./tests/register.mjs --test tests/symlink-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-symlink-routes-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Ctx<P> = { params: Promise<P> };
const source = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as {
  GET: (req: InstanceType<typeof NextRequest>, ctx: Ctx<{ workspace: string }>) => Promise<Response>;
  PUT: (req: InstanceType<typeof NextRequest>, ctx: Ctx<{ workspace: string }>) => Promise<Response>;
};
const archive = (await import("../app/api/workspaces/[workspace]/runs/[runId]/archive/route.ts")) as {
  GET: (req: InstanceType<typeof NextRequest>, ctx: Ctx<{ workspace: string; runId: string }>) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const RUN = "run-fol83-route";
const ws = path.join(DATA, TENANT, "workspaces", WS);
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-outside-"));
fs.mkdirSync(path.join(ws, "knowledge"), { recursive: true });
fs.mkdirSync(path.join(ws, "skills"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(outside, "secret.md"), "outside-secret\n");
fs.writeFileSync(path.join(outside, "victim.md"), "untouched\n");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(ws, "knowledge/leak.md"));
fs.symlinkSync(path.join(outside, "victim.md"), path.join(ws, "skills/victim.md"));
fs.symlinkSync(outside, path.join(ws, "knowledge/out"));
const out = path.join(ws, "runs", RUN, "outputs", "writer");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ws, "runs", `${RUN}.json`), JSON.stringify({ id: RUN, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [] }));
fs.writeFileSync(path.join(out, "report.md"), "# report\n");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(out, "leak.md"));

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const ctx = { params: Promise.resolve({ workspace: WS }) };
const get = (rel: string) => source.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/source?path=${encodeURIComponent(rel)}`, { headers }), ctx);
const put = (rel: string, content: string) =>
  source.PUT(new NextRequest(`http://localhost/api/workspaces/${WS}/source`, { method: "PUT", headers, body: JSON.stringify({ path: rel, content }) }), ctx);
const fetchOutput = (rel: string) =>
  archive.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${RUN}/archive?agent=writer&path=${encodeURIComponent(rel)}`, { headers }), {
    params: Promise.resolve({ workspace: WS, runId: RUN }),
  });

test("GET /source through a file link or a folder link: 400, and the outside text is not in the answer", async () => {
  for (const rel of ["knowledge/leak.md", "knowledge/out/secret.md"]) {
    const res = await get(rel);
    const text = await res.text();
    assert.equal(res.status, 400, `${rel}: ${text}`);
    assert.match(text, /leads out of the workspace through a symlink/);
    assert.doesNotMatch(text, /outside-secret/);
  }
});

test("PUT /source: no overwrite through a file link, no new file through a folder link", async () => {
  assert.equal((await put("skills/victim.md", "OVERWRITTEN")).status, 400);
  assert.equal(fs.readFileSync(path.join(outside, "victim.md"), "utf8"), "untouched\n");
  assert.equal((await put("knowledge/out/planted.md", "PLANTED")).status, 400);
  assert.deepEqual(fs.readdirSync(outside).sort(), ["secret.md", "victim.md"]);
  assert.equal((await put("knowledge/ordinary.md", "---\ntype: note\n---\nfine")).status, 200, "an ordinary save still works");
});

test("the run archive does not serve an output that links out, and still serves a real one", async () => {
  const leak = await fetchOutput("leak.md");
  assert.equal(leak.status, 404);
  assert.doesNotMatch(await leak.text(), /outside-secret/);
  const real = await fetchOutput("report.md");
  assert.equal(real.status, 200);
  assert.match(await real.text(), /# report/);
});
