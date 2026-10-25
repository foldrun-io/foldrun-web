// Index-based flow writes from the list-view board and the step options
// editor carry `expect` — the text their step indices were read from — so a
// stale board is refused (409) instead of editing whichever step has that
// index now, and the 409 reads "this flow changed since you opened it —
// reload". The canvas has sent it since 188f197; these are the other callers.
//
//   node --import ./tests/register.mjs --test tests/flow-write-expect.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-flow-write-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Ctx = { params: Promise<{ workspace: string; flow: string }> };
type Handler = (req: InstanceType<typeof NextRequest>, ctx: Ctx) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/flows/[flow]/route.ts")) as { PATCH: Handler; DELETE: Handler };
const { flowWrite, STALE_FLOW } = await import("../components/flow-write.ts");

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
const FILE = path.join(ws, "flows", "daily.md");
const ORIGINAL = "---\nname: daily\n---\n\n1. [[a]] — first\n2. [[b]] — second\n3. [[c]] — third\n";
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");

// flowWrite's fetch, answered by the route itself.
const viaRoute: typeof fetch = async (input, init) => {
  const req = new NextRequest(`http://localhost${String(input)}`, {
    method: init?.method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: init?.body as string,
  });
  const handler = init?.method === "DELETE" ? route.DELETE : route.PATCH;
  return handler(req, { params: Promise.resolve({ workspace: WS, flow: "daily" }) });
};
const URL_ = `/api/workspaces/${WS}/flows/daily`;

for (const [name, method, body] of [
  ["groups (board drag)", "PATCH", { groups: [[1], [0], [2]] }],
  ["step instruction (board)", "PATCH", { step: 0, instruction: "changed" }],
  ["step options (options editor)", "PATCH", { step: 0, options: { retry: "2" } }],
  ["remove a step (board ✕)", "DELETE", { step: 0 }],
] as const) {
  test(`${name}: a stale board is refused and says reload; the file is untouched`, async () => {
    fs.writeFileSync(FILE, ORIGINAL);
    const seen = ORIGINAL;
    // Someone else removed step 1 since the board was drawn.
    const moved = ORIGINAL.replace("1. [[a]] — first\n", "").replace("2. [[b]]", "1. [[b]]").replace("3. [[c]]", "2. [[c]]");
    fs.writeFileSync(FILE, moved);
    const r = await flowWrite({ url: URL_, method, tenant: TENANT, body, expect: seen, fetch: viaRoute });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.stale, true);
    assert.equal(r.ok === false && r.error, STALE_FLOW);
    assert.equal(fs.readFileSync(FILE, "utf8"), moved);
  });

  test(`${name}: a current board writes`, async () => {
    fs.writeFileSync(FILE, ORIGINAL);
    const r = await flowWrite({ url: URL_, method, tenant: TENANT, body, expect: ORIGINAL, fetch: viaRoute });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.notEqual(fs.readFileSync(FILE, "utf8"), ORIGINAL);
  });
}

test("flowWrite puts expect in the body it sends", async () => {
  let sent: Record<string, unknown> = {};
  const spy: typeof fetch = async (_u, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await flowWrite({ url: URL_, method: "PATCH", tenant: TENANT, body: { groups: [[0]] }, expect: "abc", fetch: spy });
  assert.deepEqual(sent, { groups: [[0]], expect: "abc" });
});

// Every index-based write on the board and in the options editor goes
// through flowWrite: no bare fetch to the flow route left behind.
for (const file of ["app/dashboard/[workspace]/flows/flow-board.tsx", "app/dashboard/[workspace]/flows/step-options.tsx"]) {
  test(`${file}: no flow PATCH/DELETE bypasses flowWrite`, () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf8");
    assert.ok(src.includes("flowWrite("), "uses flowWrite");
    // A bare fetch to the flow route itself (not …/run) may only be the
    // add-step POST, which names no index.
    const bare = [...src.matchAll(/fetch\(`\/api\/workspaces\/\$\{workspace\}\/flows\/\$\{flow\}`,([\s\S]{0,200})/g)];
    for (const m of bare) assert.match(m[1], /method:\s*"POST"/, `a bare flow write: ${m[1].slice(0, 80)}`);
    // The board's ✕ goes through `mutate`, whose DELETE must reach flowWrite.
    if (src.includes('mutate("DELETE"')) assert.match(src, /await write\("DELETE"/);
  });
}
