// Files to text, the routes (12 Nov 2026): POST /api/extract, GET
// /api/extract/<id>, POST …/storage/extract. Who may, the refusals before
// the body is read, wait → 200 or 202 + poll, the .txt written beside a
// stored file, and who may read a job. The extraction itself (parser,
// Whisper, artifacts, limits) is tested in foldrun-platform
// tests/extract.test.ts; the parser is faked here through its seam.
//
//   node --import ./tests/register.mjs --test tests/extract-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-extract-routes-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_EXTRACT_URL = "http://extract:8090";
process.env.FOLDRUN_EXTRACT_RATE_PER_MIN = "1000";
process.env.FOLDRUN_EXTRACT_ACCOUNT_CAP = "50";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const extract = await import("@/platform/extract");
const storage = await import("@/lib/storage");
type Req = InstanceType<typeof NextRequest>;
type Ctx<P> = { params: Promise<P> };
const post = (await import("../app/api/extract/route.ts")) as unknown as { POST: (req: Req) => Promise<Response> };
const poll = (await import("../app/api/extract/[id]/route.ts")) as unknown as { GET: (req: Req, ctx: Ctx<{ id: string }>) => Promise<Response> };
const stored = (await import("../app/api/workspaces/[workspace]/storage/extract/route.ts")) as unknown as { POST: (req: Req, ctx: Ctx<{ workspace: string }>) => Promise<Response> };

const TENANT = "acme";
for (const ws of ["desk", "other"]) {
  const p = path.join(DATA, TENANT, "workspaces", ws, "AGENTS.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\nname: ${ws}\n---\n`);
}
const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const { key: deskOnly } = await createApiKey(TENANT, "desk-only", "owner@acme.test", undefined, "editor", ["desk"]);
const { key: otherOnly } = await createApiKey(TENANT, "other-only", "owner@acme.test", undefined, "editor", ["other"]);
const { key: stranger } = await createApiKey("globex", "stranger", "x@globex.test", undefined, "admin");

await storage.putFile(TENANT, "desk", "scans/letter.png", Buffer.from("png-bytes-of-a-letter"), "user:owner@acme.test");
await storage.putFile(TENANT, "desk", "notes/already.txt", Buffer.from("plain text"), "user:owner@acme.test");

/** The fake parser: an image's OCR text; `hold` keeps it from answering until released. */
let hold: Promise<void> | null = null;
let answer: { status: number; body: unknown } = { status: 200, body: { kind: "image", format: "png", text: "نامه — letter", confidence: 88, engine: "tesseract:fas+eng", needs_speech: false, truncated: false, warnings: [] } };
const asked: URL[] = [];
extract.setExtractFetchForTests(async (input) => {
  asked.push(new URL(String(input)));
  if (hold) await hold;
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
});

const sendFile = (key: string, body: Uint8Array, query = "", headers: Record<string, string> = {}) =>
  post.POST(
    new NextRequest(`http://localhost/api/extract${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/octet-stream", "content-length": String(body.length), ...headers },
      body: body as Uint8Array<ArrayBuffer>,
    }),
  );
const getJob = (key: string, id: string) =>
  poll.GET(new NextRequest(`http://localhost/api/extract/${id}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id }) });
const fromStorage = (key: string, ws: string, body: Record<string, unknown>) =>
  stored.POST(
    new NextRequest(`http://localhost/api/workspaces/${ws}/storage/extract`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: ws }) },
  );
const bytes = (label: string) => new Uint8Array(Buffer.from(`${label}-${crypto.randomBytes(6).toString("hex")}`));

test("POST /api/extract: the text at once; the same file again is cached", async () => {
  const file = bytes("photo");
  const r = await sendFile(editor, file, "?name=photo.png&lang=fa");
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.text, "نامه — letter");
  assert.equal(body.kind, "image");
  assert.equal(body.cached, false);
  assert.equal(body.sha256, crypto.createHash("sha256").update(file).digest("hex"));
  assert.equal(asked.at(-1)?.searchParams.get("lang"), "fas+eng");
  assert.equal(asked.at(-1)?.searchParams.get("name"), "photo.png");
  const again = await sendFile(editor, file, "?name=photo.png&lang=fa");
  assert.equal((await again.json()).cached, true);
});

test("POST /api/extract: who may not, and what is refused before the body is read", async () => {
  assert.equal((await sendFile(viewer, bytes("v"))).status, 403, "a viewer cannot start one (run:start)");
  assert.equal((await sendFile("fr_not_a_key", bytes("v"))).status, 401);
  const noLen = await post.POST(new NextRequest("http://localhost/api/extract", { method: "POST", headers: { authorization: `Bearer ${editor}` }, body: new ReadableStream(), duplex: "half" } as never));
  assert.equal(noLen.status, 411);
  assert.equal((await sendFile(editor, bytes("big"), "", { "content-length": String(101 * 1024 * 1024) })).status, 413);
  assert.equal((await sendFile(editor, new Uint8Array(0))).status, 400);
  const badLang = await sendFile(editor, bytes("x"), "?lang=klingon");
  assert.equal(badLang.status, 400);
  assert.equal((await badLang.json()).code, "bad_request");
  assert.equal((await sendFile(editor, bytes("x"), "?wait=99")).status, 400, "wait is 0–60");
});

test("wait=0: 202 with a job to poll; the poll says running, then done with the result", async () => {
  let release!: () => void;
  hold = new Promise((r) => (release = r));
  try {
    const r = await sendFile(editor, bytes("slow"), "?wait=0");
    assert.equal(r.status, 202);
    const started = await r.json();
    assert.equal(started.status, "running");
    assert.equal(started.poll, `/api/extract/${started.id}`);
    const running = await getJob(editor, started.id);
    assert.equal(running.status, 200);
    assert.equal((await running.json()).status, "running");
    release();
    hold = null;
    await extract.waitForJob(TENANT, started.id, 5);
    const done = await (await getJob(editor, started.id)).json();
    assert.equal(done.status, "done");
    assert.equal(done.result.text, "نامه — letter");
    assert.ok(done.finishedAt);
    assert.equal("wrote" in done, false, "a job that writes nothing says nothing of a .txt");
    // Another account never sees it; a made-up id is the same 404.
    assert.equal((await getJob(stranger, started.id)).status, 404);
    assert.equal((await getJob(editor, "xj-nosuchjob00000")).status, 404);
    assert.equal((await getJob(editor, "not-an-id")).status, 404);
  } finally {
    release?.();
    hold = null;
  }
});

test("a key held to some workspaces reads its own account-level jobs and its workspaces', no others", async () => {
  const mine = await (await sendFile(deskOnly, bytes("scoped"), "?wait=10")).json();
  assert.ok(mine.text, "a scoped editor may extract a file it sends");
  const theirs = await sendFile(editor, bytes("unscoped"), "?wait=0");
  const theirId = (await theirs.json()).id;
  const ownJob = await sendFile(deskOnly, bytes("scoped-poll"), "?wait=0");
  const ownId = (await ownJob.json()).id;
  assert.ok(ownId && theirId, "wait=0 answers a job to poll");
  assert.equal((await getJob(deskOnly, ownId)).status, 200, "its own account-level job");
  assert.equal((await getJob(otherOnly, ownId)).status, 404, "another scoped key's account-level job");
  assert.equal((await getJob(deskOnly, theirId)).status, 404, "an unscoped key's account-level job");
  // A storage job of desk: desk's key reads it, other's does not.
  let release!: () => void;
  hold = new Promise((r) => (release = r));
  try {
    const r = await fromStorage(editor, "desk", { path: "scans/letter.png", write: false, wait: 0 });
    assert.equal(r.status, 202);
    const id = (await r.json()).id;
    assert.equal((await getJob(deskOnly, id)).status, 200);
    assert.equal((await getJob(otherOnly, id)).status, 404);
    release();
    hold = null;
    await extract.waitForJob(TENANT, id, 5);
  } finally {
    release?.();
    hold = null;
  }
});

test("…/storage/extract: the text, written to <path>.txt beside the file", async () => {
  const r = await fromStorage(editor, "desk", { path: "scans/letter.png", lang: "en" });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.text, "نامه — letter");
  assert.equal(body.wrote, "scans/letter.png.txt");
  assert.equal(asked.at(-1)?.searchParams.get("lang"), "eng");
  assert.equal((await storage.readFileBytes(TENANT, "desk", "scans/letter.png.txt"))?.toString("utf8"), "نامه — letter");
  assert.equal(storage.getFile(TENANT, "desk", "scans/letter.png.txt")?.by, "user:owner@acme.test", "written by who asked (the key's minter)");
});

test("…/storage/extract: write needs workspace:write, reading needs read; a .txt, a missing file, an unknown workspace", async () => {
  assert.equal((await fromStorage(viewer, "desk", { path: "scans/letter.png" })).status, 403, "a viewer cannot write the .txt");
  const read = await fromStorage(viewer, "desk", { path: "scans/letter.png", write: false });
  assert.equal(read.status, 200, "a viewer may read the text");
  assert.equal((await read.json()).wrote, null);
  assert.equal((await fromStorage(otherOnly, "desk", { path: "scans/letter.png", write: false })).status, 403, "a key held to another workspace");
  const txt = await fromStorage(editor, "desk", { path: "notes/already.txt" });
  assert.equal(txt.status, 400);
  assert.match((await txt.json()).error, /already text/);
  assert.equal((await fromStorage(editor, "desk", { path: "nope/missing.pdf" })).status, 404);
  assert.equal((await fromStorage(editor, "nosuch", { path: "scans/letter.png" })).status, 404);
  assert.equal((await fromStorage(editor, "desk", {})).status, 400);
  assert.equal((await fromStorage(editor, "desk", { path: "scans/letter.png", write: "yes" })).status, 400);
});

test("the parser's refusals and an unconfigured server answer with their status and code", async () => {
  answer = { status: 415, body: { error: { code: "unsupported", message: "this is a zip archive" } } };
  try {
    const r = await sendFile(editor, bytes("zip"));
    assert.equal(r.status, 415);
    const body = await r.json();
    assert.equal(body.code, "unsupported");
    assert.match(body.error, /zip archive/);
  } finally {
    answer = { status: 200, body: { kind: "image", format: "png", text: "نامه — letter", engine: "tesseract:fas+eng", needs_speech: false, truncated: false, warnings: [] } };
  }
  const saved = process.env.FOLDRUN_EXTRACT_URL;
  delete process.env.FOLDRUN_EXTRACT_URL;
  try {
    const r = await sendFile(editor, bytes("nothing"));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "text extraction is not configured on this server", code: "not_configured" });
  } finally {
    process.env.FOLDRUN_EXTRACT_URL = saved;
  }
});

test("past the account's jobs in flight: 429 with Retry-After", async () => {
  process.env.FOLDRUN_EXTRACT_ACCOUNT_CAP = "1";
  let release!: () => void;
  hold = new Promise((r) => (release = r));
  try {
    const first = await sendFile(editor, bytes("one"), "?wait=0");
    assert.equal(first.status, 202);
    const second = await sendFile(editor, bytes("two"), "?wait=0");
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) > 0);
    assert.equal((await second.json()).code, "too_many_running");
    release();
    hold = null;
    await extract.waitForJob(TENANT, (await first.json()).id, 5);
  } finally {
    release?.();
    hold = null;
    process.env.FOLDRUN_EXTRACT_ACCOUNT_CAP = "50";
  }
});
