// A body over the API limit is refused whole, never truncated.
//
// Next.js cut a 30 MB PUT to /storage down to its first 10 MB and the route
// stored that and answered 200 (2026-09-25). The proxy now says 413 first.
// A chunked body declares no length for the proxy to refuse, and Next hands
// the route what it buffered before the limit, so the storage route checks
// what arrived: no length is a 411, a length it did not get is a 400.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_BODY_LIMIT_BYTES, bodyTooLarge, bodyCut } from "../server/body-limit.ts";

const put = (bytes: number) =>
  new NextRequest("https://app.example.test/api/workspaces/desk/storage?path=big.jsonl", {
    method: "PUT",
    headers: { "content-length": String(bytes), authorization: "Bearer mda_x" },
  });

test("a body over the limit is a 413 that says where large files go", async () => {
  const res = await proxy(put(30 * 1024 * 1024));
  assert.equal(res.status, 413);
  const body = await res.json();
  assert.match(body.error, /30\.0 MB/);
  assert.match(body.error, /upload-url/);
});

test("a body at the limit, or with no length, passes to the route", async () => {
  assert.equal((await proxy(put(API_BODY_LIMIT_BYTES))).status, 200);
  assert.equal(bodyTooLarge(null), null);
  assert.equal(bodyTooLarge("not a number"), null);
});

test("bodyCut: a stored body must have a length, and must have arrived at it", () => {
  assert.equal(bodyCut("5", 5), null);
  assert.equal(bodyCut(null, 5)?.status, 411);
  assert.equal(bodyCut(null, API_BODY_LIMIT_BYTES - 16 * 1024)?.status, 411, "a body Next cut short of the limit");
  assert.equal(bodyCut(String(API_BODY_LIMIT_BYTES + 1), API_BODY_LIMIT_BYTES)?.status, 413);
  assert.equal(bodyCut(null, API_BODY_LIMIT_BYTES + 1)?.status, 413);
  assert.equal(bodyCut("100", 60)?.status, 400);
});

test("storage PUT: a chunked body is refused and nothing is stored", async () => {
  process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-body-limit-"));
  process.env.FOLDRUN_DEV_NO_AUTH = "1";
  const ws = path.join(process.env.FOLDRUN_DATA, "default", "workspaces", "desk");
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  const { PUT } = await import("../app/api/workspaces/[workspace]/storage/route.ts");
  const { getFile } = await import("../../foldrun-core/src/storage.ts");
  const ctx = { params: Promise.resolve({ workspace: "desk" }) };
  const send = (name: string, body: Buffer, length?: number) =>
    PUT(new NextRequest(`https://app.example.test/api/workspaces/desk/storage?path=${name}`, {
      method: "PUT",
      headers: length === undefined ? {} : { "content-length": String(length) },
      body: new Uint8Array(body),
    }), ctx);
  // What the route sees of a 30 MB chunked PUT: the chunks before the limit.
  const cut = Buffer.alloc(API_BODY_LIMIT_BYTES - 64 * 1024, 1);
  assert.equal((await send("big.jsonl", cut)).status, 411);
  assert.equal(getFile("default", "desk", "big.jsonl"), null);
  assert.equal((await send("big.jsonl", cut, 30 * 1024 * 1024)).status, 413);
  assert.equal(getFile("default", "desk", "big.jsonl"), null);
  assert.equal((await send("small.txt", Buffer.from("hello"), 5)).status, 200);
});
