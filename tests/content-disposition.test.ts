// A download named in any script is served, not a 500.
//
// Header values are ByteStrings, so `filename="報告.pdf"` threw inside the
// Headers constructor. The name now goes out twice: ASCII for old clients,
// and exact as UTF-8 in filename*.
//
//   node --import ./tests/register.mjs --test tests/content-disposition.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-disposition-"));
process.env.FOLDRUN_DEV_NO_AUTH = "1";
const { NextRequest } = await import("next/server");
const { contentDisposition } = await import("../server/content-disposition.ts");
const { putFile } = await import("../../foldrun-core/src/storage.ts");
const download = await import("../app/api/workspaces/[workspace]/storage/download/route.ts");

test("a name outside Latin-1 is a valid header, ASCII first and exact in filename*", () => {
  const value = contentDisposition("attachment", 'résumé "報告" 🎉.pdf');
  assert.doesNotThrow(() => new Headers({ "content-disposition": value }));
  assert.equal(value, `attachment; filename="r_sum_ ____ _.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22%E5%A0%B1%E5%91%8A%22%20%F0%9F%8E%89.pdf`);
  assert.equal(contentDisposition("inline", "plain.txt"), `inline; filename="plain.txt"; filename*=UTF-8''plain.txt`);
});

test("a stored file named in Japanese downloads with 200, as an attachment and as a preview", async () => {
  const ws = path.join(process.env.FOLDRUN_DATA!, "default", "workspaces", "desk");
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
  await putFile("default", "desk", "報告.pdf", Buffer.from("%PDF-1.4"), "test");
  const ctx = { params: Promise.resolve({ workspace: "desk" }) };
  for (const q of ["", "&inline=1"]) {
    const res = await download.GET(new NextRequest(`http://x/api/workspaces/desk/storage/download?path=${encodeURIComponent("報告.pdf")}${q}`), ctx);
    assert.equal(res.status, 200, q);
    assert.match(res.headers.get("content-disposition")!, /filename\*=UTF-8''%E5%A0%B1%E5%91%8A\.pdf/);
  }
});
