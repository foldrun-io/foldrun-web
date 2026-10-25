// The gallery's one web tool is `web`. web_search, web_fetch and web_browse
// were its actions' older names and are gone entirely: not served, not
// offered, and an install of one is a plain 404 like any unknown name.
//
//   node --import ./tests/register.mjs --test tests/gallery-web-only.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gallery-web-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
const { NextRequest } = await import("next/server");
const { GET, POST } = await import("../app/api/library/gallery/route.ts");
const { startFrom } = await import("../server/starters.ts");
const { createApiKey } = await import("../server/auth.ts");

const OLD = ["web_search", "web_fetch", "web_browse"];
const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const req = (method: string, body?: object) =>
  new NextRequest("http://x/api/library/gallery", {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test("GET serves web and none of the older names", async () => {
  const { tools } = (await (await GET(req("GET"))).json()) as { tools: Record<string, unknown>[] };
  assert.ok(tools.some((t) => t.name === "web"));
  for (const name of OLD) assert.equal(tools.find((t) => t.name === name), undefined, name);
  assert.ok(tools.every((t) => !("retired" in t)), "no entry carries a retired mark");
});

test("installing an older name is a plain 404", async () => {
  for (const name of OLD) {
    const res = await POST(req("POST", { tool: name }));
    assert.equal(res.status, 404, name);
    assert.match((await res.json()).error, /no gallery tool named/);
  }
});

test("the New dialog offers web as a starting point, and nothing older", () => {
  const values = (startFrom("tools")?.choices ?? []).map((s) => s.value);
  assert.ok(values.includes("web"));
  for (const name of OLD) assert.ok(!values.includes(name), name);
});
