// Two reads the CLI could not make (5 Nov 2026): which files a run archived
// (GET …/runs/<id>/files — the run page's Out column, which the page reads on
// the server), and the runs list a page at a time (GET …/runs?before=, which
// answers `next`). Both scoped like every /api/workspaces/<ws>/… read.
//
//   node --import ./tests/register.mjs --test tests/runs-files-paging.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-runs-files-paging-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: InstanceType<typeof NextRequest>, ctx: Ctx<P>) => Promise<Response>;
const filesRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/files/route.ts")) as { GET: Handler<{ workspace: string; runId: string }> };
const runsRoute = (await import("../app/api/workspaces/[workspace]/runs/route.ts")) as { GET: Handler<{ workspace: string }> };
const archiveRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/archive/route.ts")) as { GET: Handler<{ workspace: string; runId: string }> };

const TENANT = "acme";
const WS = "desk";
const OTHER = "other-desk";
const wsDir = (name: string) => path.join(DATA, TENANT, "workspaces", name);
for (const name of [WS, OTHER]) {
  fs.mkdirSync(path.join(wsDir(name), "runs"), { recursive: true });
  fs.writeFileSync(path.join(wsDir(name), "AGENTS.md"), `---\nname: ${name}\n---\n`);
}
const t0 = Date.parse("2026-11-01T00:00:00.000Z");
const writeRun = (ws: string, id: string, minutes: number, status = "completed") =>
  fs.writeFileSync(
    path.join(wsDir(ws), "runs", `${id}.json`),
    JSON.stringify({ id, flow: "daily", status, startedAt: new Date(t0 + minutes * 60_000).toISOString(), steps: [] }),
  );

// The run with an archive: two agents, one file in a folder, one with a
// name that needs escaping in a link.
const RUN = "run-archived";
writeRun(WS, RUN, 500);
const archive = path.join(wsDir(WS), "runs", RUN, "outputs");
fs.mkdirSync(path.join(archive, "writer", "img"), { recursive: true });
fs.mkdirSync(path.join(archive, "editor"), { recursive: true });
fs.writeFileSync(path.join(archive, "writer", "draft.md"), "# Draft\n");
fs.writeFileSync(path.join(archive, "writer", "img", "cover & title.png"), Buffer.alloc(1234));
fs.writeFileSync(path.join(archive, "editor", "notes.txt"), "tighten it");
writeRun(WS, "run-empty", 400);

// Twelve more for paging, two of them in the same millisecond.
for (let i = 0; i < 10; i++) writeRun(WS, `run-p${String(i).padStart(2, "0")}`, i * 10, i % 3 === 0 ? "failed" : "completed");
writeRun(WS, "run-tie-a", 200);
writeRun(WS, "run-tie-b", 200);
writeRun(OTHER, "run-elsewhere", 1);

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "viewer");
const { key: scoped } = await createApiKey(TENANT, "scoped", "owner@acme.test", undefined, "viewer", [OTHER]);

const get = <P>(route: { GET: Handler<P> }, url: string, params: P, k: string = key) =>
  route.GET(new NextRequest(`http://localhost${url}`, { headers: { authorization: `Bearer ${k}` } }), { params: Promise.resolve(params) });
const files = (runId: string, ws = WS, k = key) => get(filesRoute, `/api/workspaces/${ws}/runs/${runId}/files`, { workspace: ws, runId }, k);
const runs = (query: string, ws = WS, k = key) => get(runsRoute, `/api/workspaces/${ws}/runs${query}`, { workspace: ws }, k);

// ------------------------------------------------------------------ files

test("files lists what the run archived, by agent then path, with the link that serves each", async () => {
  const res = await files(RUN);
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { runId: string; files: { agent: string; path: string; bytes: number; href: string }[]; totalBytes: number };
  assert.equal(body.runId, RUN);
  assert.deepEqual(
    body.files.map((f) => [f.agent, f.path, f.bytes]),
    [
      ["editor", "notes.txt", 10],
      ["writer", "draft.md", 8],
      ["writer", "img/cover & title.png", 1234],
    ],
  );
  assert.equal(body.totalBytes, 10 + 8 + 1234);
  // The href is the one the run page draws — and it serves those bytes.
  const cover = body.files[2];
  assert.equal(cover.href, `/api/workspaces/${WS}/runs/${RUN}/archive?agent=writer&path=img%2Fcover%20%26%20title.png`);
  const served = await get(archiveRoute, cover.href, { workspace: WS, runId: RUN });
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, 1234);
});

test("a run that archived nothing answers an empty list; no such run is a 404", async () => {
  const empty = await files("run-empty");
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { runId: "run-empty", files: [], totalBytes: 0, refused: [], refusedCount: 0 });
  assert.equal((await files("run-nope")).status, 404);
  assert.equal((await files(RUN, OTHER)).status, 404, "a run is looked for in the workspace named, not across them");
});

test("a key scoped to another workspace is refused this run's files and runs list", async () => {
  assert.equal((await files(RUN, WS, scoped)).status, 403);
  assert.equal((await runs("", WS, scoped)).status, 403);
  assert.equal((await runs("", OTHER, scoped)).status, 200, "its own workspace still answers");
  const none = await filesRoute.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${RUN}/files`), { params: Promise.resolve({ workspace: WS, runId: RUN }) });
  assert.equal(none.status, 401);
});

// ----------------------------------------------------------------- paging

type Page = { runs: { id: string; startedAt: string }[]; next: string | null };
const page = async (query: string): Promise<Page> => {
  const res = await runs(query);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Page;
};
const ALL = [RUN, "run-empty", "run-tie-b", "run-tie-a", ...Array.from({ length: 10 }, (_, i) => `run-p${String(9 - i).padStart(2, "0")}`)];

test("without before the list is as it was — the newest first — and says next", async () => {
  const p = await page("");
  assert.deepEqual(p.runs.map((r) => r.id), ALL, "a tie on startedAt is broken by id");
  assert.equal(p.next, null, "everything fit");
  const first = await page("?limit=5");
  assert.deepEqual(first.runs.map((r) => r.id), ALL.slice(0, 5));
  assert.equal(first.next, `${first.runs[4].startedAt}~${first.runs[4].id}`);
});

test("next, passed back as before, walks every run once — through a tie", async () => {
  const seen: string[] = [];
  let before: string | null = null;
  for (let i = 0; i < 20; i++) {
    const p = await page(`?limit=3${before ? `&before=${encodeURIComponent(before)}` : ""}`);
    seen.push(...p.runs.map((r) => r.id));
    before = p.next;
    if (!before) break;
  }
  assert.deepEqual(seen, ALL);
  // limit=1 splits the tie itself across two pages.
  const a = await page(`?limit=1&before=${encodeURIComponent(`${new Date(t0 + 400 * 60_000).toISOString()}~run-empty`)}`);
  assert.deepEqual(a.runs.map((r) => r.id), ["run-tie-b"]);
  const b = await page(`?limit=1&before=${encodeURIComponent(a.next!)}`);
  assert.deepEqual(b.runs.map((r) => r.id), ["run-tie-a"]);
});

test("a cursor is a position: the run it names may be gone", async () => {
  const p = await page(`?limit=2&before=${encodeURIComponent(`${new Date(t0 + 450 * 60_000).toISOString()}~run-deleted`)}`);
  assert.deepEqual(p.runs.map((r) => r.id), ["run-empty", "run-tie-b"]);
});

test("before takes a time or a run id too, and pages after the filters", async () => {
  const byTime = await page(`?before=${encodeURIComponent(new Date(t0 + 200 * 60_000).toISOString())}&limit=2`);
  assert.deepEqual(byTime.runs.map((r) => r.id), ["run-p09", "run-p08"], "strictly before the time: the tie at it is left out");
  const byDay = await page("?before=2026-11-01T01:00:00Z");
  assert.deepEqual(byDay.runs.map((r) => r.id), ["run-p05", "run-p04", "run-p03", "run-p02", "run-p01", "run-p00"]);
  const byId = await page("?before=run-tie-a&limit=1");
  assert.deepEqual(byId.runs.map((r) => r.id), ["run-p09"]);
  // The search narrows first; limit and next count its matches.
  const res = await runs("?agent=nobody&before=run-p05");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { runs: [], next: null });
});

test("a before that is none of these is a 400, never the newest page again", async () => {
  for (const bad of ["run-nope", "not-a-time~run-p01", "2026-13-45", "2026-11-01T00:00:00.000Z~", " "]) {
    const res = await runs(`?before=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, `before=${bad}`);
    assert.match(((await res.json()) as { error: string }).error, /before/);
  }
});
