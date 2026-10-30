// The proxy refuses an /api/ path that holds an encoded / \ or NUL, or a
// . / .. segment (30 Oct 2026): Next decodes %2F inside a dynamic segment,
// so `agents/..%2F..%2F<tenant>%2F…/run` handed a route a path where it
// expected a name. No route takes one — app/api has no catch-all segment —
// so nothing a client of ours sends is refused.
//
//   node --import ./tests/register.mjs --test tests/raw-path.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-raw-path-"));
process.env.FOLDRUN_SECRET_KEY = "raw-path-key";
const { NextRequest } = await import("next/server");
const { proxy } = await import("../proxy.ts");
const { unsafeApiPath } = await import("../server/raw-path.ts");

test("unsafeApiPath: encoded separators, NUL and dot segments are refused; names pass", () => {
  for (const bad of [
    "/api/workspaces/desk/agents/..%2F..%2Fother%2Fworkspaces%2Fw%2Fagents%2Fspy/run",
    "/api/workspaces/desk/agents/..%2f..%2fother/run",
    "/api/workspaces/desk/hooks/a%5Cb/test",
    "/api/workspaces/desk/hooks/a%5cb/test",
    "/api/workspaces/desk%00/runs",
    "/api/workspaces/%2e%2e/runs",
    "/api/workspaces/.%2E/runs",
    "/api/workspaces/%2e/runs",
    "/api/workspaces/desk/agents/%E0%A4%A/run",
  ]) assert.ok(unsafeApiPath(bad), bad);
  for (const ok of [
    "/api/workspaces",
    "/api/workspaces/desk/agents/code_reviewer/run",
    "/api/workspaces/desk/runs/run-abc123/stream",
    "/api/workspaces/desk/tools/mcp__crm__lookup/test",
    "/api/hooks/acme/desk/daily",
    "/api/workspaces/desk/agents/..foo/run",
    "/api/workspaces/desk/agents/a%252Fb/run", // decodes once, to a literal "%2F" — a name, if an odd one
  ]) assert.equal(unsafeApiPath(ok), null, ok);
});

test("the proxy answers such a path 400 with { error }, hardened and stamped, before any route", async () => {
  const r = await proxy(new NextRequest("https://app.example.test/api/workspaces/desk/agents/..%2F..%2Fother%2Fagents%2Fspy/run", { method: "POST" }));
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error?: string };
  assert.match(body.error ?? "", /encoded/);
  assert.equal(r.headers.get("x-frame-options"), "DENY", "hardened like the other refusals");
  assert.ok(r.headers.get("x-foldrun-version") !== null, "stamped with the version");
  assert.notEqual(r.headers.get("x-middleware-next"), "1", "never passed on");
});
