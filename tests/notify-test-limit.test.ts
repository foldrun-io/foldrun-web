// POST …/notify/test is held to 10 an hour per workspace (30 Oct 2026). Each
// one is real mail from the platform's domain, or a POST, to an address an
// editor chose, and a loop with fresh Idempotency-Keys was bounded only by
// the API's general write limit.
//
//   node --import ./tests/register.mjs --test tests/notify-test-limit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-notify-test-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const TENANT = "acme";
for (const ws of ["desk", "other"]) {
  fs.mkdirSync(path.join(DATA, TENANT, "workspaces", ws), { recursive: true });
  // No notify: — the route answers "nothing would be sent" and sends nothing.
  fs.writeFileSync(path.join(DATA, TENANT, "workspaces", ws, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
}

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const route = await import("../app/api/workspaces/[workspace]/notify/test/route.ts");
const { key } = await createApiKey(TENANT, "ci", "ed@acme.test", undefined, "editor");

const send = (ws: string, n: number) =>
  route.POST(
    new NextRequest(`http://localhost/api/workspaces/${ws}/notify/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": `k-${ws}-${n}` },
    }),
    { params: Promise.resolve({ workspace: ws }) },
  );

test("ten test sends an hour per workspace; the eleventh is a 429 with Retry-After; another workspace is its own count", async () => {
  for (let i = 1; i <= 10; i++) assert.equal((await send("desk", i)).status, 200, `send ${i}`);
  const refused = await send("desk", 11);
  assert.equal(refused.status, 429);
  assert.ok(refused.headers.get("retry-after"));
  assert.equal((await send("other", 1)).status, 200);
});
