// Previews on an object store (PR #15). Every picture core previews is
// streamed from here — the page's img-src does not name the store — while a
// video, audio or PDF preview redirects to a signed link at exactly the origin
// the CSP's media-src / frame-src name (core storeOrigin()).
//
//   node --import ./tests/register.mjs --test tests/storage-preview-store.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeS3 } from "../../foldrun-core/tests/fake-s3.ts";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-preview-store-"));
process.env.FOLDRUN_DEV_NO_AUTH = "1";
const s3 = await fakeS3("preview-bucket");
Object.assign(process.env, {
  FOLDRUN_STORAGE_DRIVER: "s3",
  FOLDRUN_S3_ENDPOINT: s3.endpoint,
  FOLDRUN_S3_BUCKET: "preview-bucket",
  FOLDRUN_S3_REGION: "us-east-1",
  FOLDRUN_S3_ACCESS_KEY_ID: "AKIATEST",
  FOLDRUN_S3_SECRET_ACCESS_KEY: "secret-test",
  // The fake answers path-style on 127.0.0.1: never inherit a virtual-hosted
  // setting from the shell running the tests.
  FOLDRUN_S3_PATH_STYLE: "true",
});
delete process.env.FOLDRUN_WORKSPACE; // single-workspace mode has no managed file store
const { NextRequest } = await import("next/server");
const { putFile, storeOrigin } = await import("../../foldrun-core/src/storage.ts");
const download = await import("../app/api/workspaces/[workspace]/storage/download/route.ts");

const ctx = { params: Promise.resolve({ workspace: "desk" }) };
const get = (rel: string, q = "&inline=1") =>
  download.GET(new NextRequest(`http://x/api/workspaces/desk/storage/download?path=${encodeURIComponent(rel)}${q}`), ctx);

test.before(() => {
  const ws = path.join(process.env.FOLDRUN_DATA!, "default", "workspaces", "desk");
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
});
test.after(async () => {
  await s3.close();
  fs.rmSync(process.env.FOLDRUN_DATA!, { recursive: true, force: true });
});

test("image previews stream from here on an object store, never a redirect — including the types that used to redirect", async () => {
  for (const [name, type] of [["a.avif", "image/avif"], ["b.apng", "image/apng"], ["c.jfif", "image/jpeg"], ["d.bmp", "image/bmp"], ["e.png", "image/png"]]) {
    await putFile("default", "desk", name, Buffer.from(`bytes of ${name}`), "test");
    const res = await get(name);
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get("location"), null, `${name}: no redirect to the store`);
    assert.equal(res.headers.get("content-type"), type, name);
    assert.equal(await res.text(), `bytes of ${name}`, name);
  }
});

test("a video preview redirects to a signed link at the origin the CSP names", async () => {
  await putFile("default", "desk", "clip.mp4", Buffer.from("not really a video"), "test");
  const res = await get("clip.mp4");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.origin, storeOrigin(), "the redirect target is exactly the store origin in media-src");
  assert.equal(to.searchParams.get("response-content-type"), "video/mp4");
});

test("a download proper still redirects to the store (big files never pass through here)", async () => {
  await putFile("default", "desk", "big.avif", Buffer.from("a picture, downloaded"), "test");
  const res = await get("big.avif", "");
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")!).origin, storeOrigin());
});
