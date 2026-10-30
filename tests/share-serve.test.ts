// GET and HEAD /s/<token>: the one route with no credential (30 Oct 2026).
// It read the whole shared file into memory on every request — HEAD too,
// only to say how long it was — and nothing counted the requests. Now it
// streams, HEAD reads only the length, and a caller or a link fetched too
// often is a 429.
//
//   node --import ./tests/register.mjs --test tests/share-serve.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-share-serve-"));
process.env.FOLDRUN_DATA = root;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const ws = path.join(root, "acct", "workspaces", "desk");
fs.mkdirSync(path.join(ws, "outputs"), { recursive: true });
fs.writeFileSync(path.join(ws, "outputs", "report.txt"), "the report");

const { NextRequest } = await import("next/server");
const route = await import("../app/s/[token]/route.ts");
const { createShare } = await import("@/platform/shares");

const call = (method: "GET" | "HEAD", token: string, headers: Record<string, string> = {}) =>
  route[method](new NextRequest(`http://x/s/${token}`, { method, headers }), { params: Promise.resolve({ token }) });

test("GET streams the file with its length; HEAD answers the length with no body", async () => {
  const { token } = await createShare("acct", "desk", "outputs/report.txt");
  const got = await call("GET", token);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-length"), "10");
  assert.equal(await got.text(), "the report");
  const head = await call("HEAD", token);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(head.body, null);
  // HEAD must not read the file: the route asks resolveShare for size(), not read().
  const src = fs.readFileSync(new URL("../app/s/[token]/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.read\(\)/, "neither verb reads the whole file any more");
});

test("a file gone since the link was made is the same 404", async () => {
  fs.writeFileSync(path.join(ws, "outputs", "gone.txt"), "x");
  const { token } = await createShare("acct", "desk", "outputs/gone.txt");
  fs.rmSync(path.join(ws, "outputs", "gone.txt"));
  assert.equal((await call("GET", token)).status, 404);
  assert.equal((await call("HEAD", token)).status, 404);
});

test("one caller, where a trusted proxy names it, is held to 120 a minute; another is not", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const { token } = await createShare("acct", "desk", "outputs/report.txt");
    const from = { "x-forwarded-for": "203.0.113.7" };
    for (let i = 1; i <= 120; i++) assert.equal((await call("HEAD", token, from)).status, 200, `request ${i}`);
    const refused = await call("HEAD", token, from);
    assert.equal(refused.status, 429);
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    assert.equal(refused.headers.get("cache-control"), "no-store");
    assert.equal((await call("HEAD", token, { "x-forwarded-for": "198.51.100.2" })).status, 200);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("with no caller to tell apart, one link is held to 1,200 a minute — and other links are not", async () => {
  const { token } = await createShare("acct", "desk", "outputs/report.txt");
  for (let i = 1; i <= 1200; i++) assert.equal((await call("HEAD", token)).status, 200, `request ${i}`);
  assert.equal((await call("HEAD", token)).status, 429);
  const other = await createShare("acct", "desk", "outputs/report.txt");
  assert.equal((await call("HEAD", other.token)).status, 200);
});
