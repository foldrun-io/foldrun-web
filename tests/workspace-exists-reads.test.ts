// Read routes under a workspace answer 404 for a workspace that does not
// exist, as their siblings do (30 Oct 2026) — vocabulary, runtimes and
// proposals used to answer 200 with an empty or account-wide answer, which
// reads as "nothing here" for a misspelt name.
//
//   node --import ./tests/register.mjs --test tests/workspace-exists-reads.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ws-exists-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const vocabulary = (await import("../app/api/workspaces/[workspace]/vocabulary/route.ts")) as unknown as { GET: Handler };
const runtimes = (await import("../app/api/workspaces/[workspace]/runtimes/route.ts")) as unknown as { GET: Handler };
const proposals = (await import("../app/api/workspaces/[workspace]/proposals/route.ts")) as unknown as { GET: Handler };
const proposal = (await import("../app/api/workspaces/[workspace]/proposals/[id]/route.ts")) as unknown as { GET: Handler; POST: Handler };

const TENANT = "acme";
fs.mkdirSync(path.join(DATA, TENANT, "workspaces/desk"), { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "workspaces/desk/AGENTS.md"), "---\nname: desk\n---\n");
const { key } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");

const call = (handler: Handler, method: string, url: string, params: Record<string, string>, body?: string) =>
  handler(
    new NextRequest(`http://localhost${url}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body }) }),
    { params: Promise.resolve(params) },
  );

test("vocabulary, runtimes and proposals: 404 for no such workspace, 200 for one that exists", async () => {
  for (const [handler, suffix] of [[vocabulary.GET, "vocabulary"], [runtimes.GET, "runtimes"], [proposals.GET, "proposals"]] as const) {
    const missing = await call(handler, "GET", `/api/workspaces/nope/${suffix}`, { workspace: "nope" });
    assert.equal(missing.status, 404, `${suffix}: ${await missing.clone().text()}`);
    const there = await call(handler, "GET", `/api/workspaces/desk/${suffix}`, { workspace: "desk" });
    assert.equal(there.status, 200, `${suffix}: ${await there.clone().text()}`);
  }
});

test("one proposal: 404 for no such workspace; a null body to POST is a 400, not a 500", async () => {
  const id = "prop_0123456789abcdef";
  const read = await call(proposal.GET, "GET", `/api/workspaces/nope/proposals/${id}`, { workspace: "nope", id });
  assert.equal(read.status, 404);
  const post = await call(proposal.POST, "POST", `/api/workspaces/desk/proposals/${id}`, { workspace: "desk", id }, "null");
  assert.equal(post.status, 400, await post.clone().text());
});
