// GET …/check?online=1 sends the server to OSV and to every remote MCP server
// the workspace names. Since 30 Oct 2026 it needs workspace:write, its answer
// is kept while the files are the same, and fresh online passes are limited
// per workspace. The plain check stays every role's read.
//
//   node --import ./tests/register.mjs --test tests/check-online-gate.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-check-online-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { platform } = await import("@/lib/platform");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/check/route.ts")) as unknown as { GET: Handler };

const ws = path.join(DATA, "acme", "workspaces", "desk");
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
  fs.writeFileSync(path.join(ws, rel), text);
};
write("AGENTS.md", "---\nname: desk\n---\n");
const agent = (n: number) => `---\nname: a\ndescription: d\nmcpServers:\n  shop:\n    url: https://mcp.example.com/mcp\n---\n\nRead ${n}.\n`;
write("agents/a/agent.md", agent(0));

// Every outbound call the online checks make goes through this; none leaves.
let outbound = 0;
platform.fetchUntrusted = (async () => {
  outbound++;
  return new Response("nope", { status: 503 });
}) as typeof platform.fetchUntrusted;

const { key: viewer } = await createApiKey("acme", "viewer", "v@acme.test", undefined, "viewer");
const { key: editor } = await createApiKey("acme", "editor", "e@acme.test", undefined, "editor");
const get = (q: string, key: string) =>
  route.GET(new NextRequest(`http://localhost/api/workspaces/desk/check${q}`, { headers: { authorization: `Bearer ${key}` } }), {
    params: Promise.resolve({ workspace: "desk" }),
  });

test("a viewer reads the check but is refused the online one, before any fetch", async () => {
  assert.equal((await get("", viewer)).status, 200);
  const res = await get("?online=1", viewer);
  assert.equal(res.status, 403);
  assert.equal(outbound, 0);
});

test("an editor's online answer is kept while the files are the same; fresh passes are limited per workspace", async () => {
  const first = await get("?online=1", editor);
  assert.equal(first.status, 200);
  const body = (await first.json()) as { online?: { problems: string[] } };
  assert.ok(body.online, "the online block is there");
  const after = outbound;
  assert.ok(after > 0, "the MCP server was asked");
  assert.equal((await get("?online=1", editor)).status, 200);
  assert.equal(outbound, after, "the same files are not fetched for again");

  // Five more fresh passes (each after a change) are allowed — six in all —
  // then the seventh is a 429 with no fetch, while the kept answer still serves.
  for (let n = 1; n <= 5; n++) {
    write("agents/a/agent.md", agent(n));
    assert.equal((await get("?online=1", editor)).status, 200, `fresh pass ${n + 1}`);
  }
  assert.equal((await get("?online=1", editor)).status, 200, "unchanged files: the kept answer, not counted");
  write("agents/a/agent.md", agent(99));
  const before = outbound;
  const refused = await get("?online=1", editor);
  assert.equal(refused.status, 429);
  assert.ok(refused.headers.get("retry-after"));
  assert.equal(outbound, before, "a refused pass fetches nothing");
  assert.equal((await get("", editor)).status, 200, "the offline check is never limited by it");
});
