// The guards on paid eval work that skips the run queue (30 Oct 2026).
//
// POST …/evals/<e>/compare started up to MAX_TRIALS paid case runs in a
// paused workspace: core's runEval runs in-process, never through the queue
// that refuses one, and unlike grade and improve the route did not look at
// the kill switch. And POST …/evals/<e>/improve queued an assistant job with
// none of the assistant's brakes — the caller's hour, the platform-paid
// account's day, the balance — so improve-then-dismiss drafted for free.
//
//   node --import ./tests/register.mjs --test tests/eval-paid-guards.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-eval-guards-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "evals"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { setPaused } = await import("../../foldrun-platform/src/admin.ts");
const { refuseAssistantJob, ASSISTANT_PER_HOUR } = await import("../server/assistant-limits.ts");
const compare = await import("../app/api/workspaces/[workspace]/evals/[evalName]/compare/route.ts");

const { key } = await createApiKey(TENANT, "ci", "ed@acme.test", undefined, "editor");

test("compare in a paused workspace is refused before anything is planned or claimed", async () => {
  await setPaused(TENANT, WS, { pause: { by: "ana@acme.test" } });
  try {
    const res = await compare.POST(
      new NextRequest(`http://localhost/api/workspaces/${WS}/evals/house-style/compare`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ configs: [{ model: "fast" }, { model: "max" }] }),
      }),
      { params: Promise.resolve({ workspace: WS, evalName: "house-style" }) },
    );
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /paused/);
  } finally {
    await setPaused(TENANT, WS, { resume: { by: "ana@acme.test" } });
  }
});

test("an assistant job is held to the caller's hour, and one caller's hour is not another's", async () => {
  const ed = { kind: "key", id: "k-ed" };
  for (let i = 1; i <= ASSISTANT_PER_HOUR; i++) assert.equal(await refuseAssistantJob(TENANT, WS, ed), null, `job ${i}`);
  const refused = await refuseAssistantJob(TENANT, WS, ed);
  assert.equal(refused?.status, 429);
  assert.ok(refused?.headers.get("retry-after"));
  assert.equal(await refuseAssistantJob(TENANT, WS, { kind: "key", id: "k-other" }), null);
});

test("improve and the assistant both take the same brakes, before the job is queued", () => {
  const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
  const improve = read("../app/api/workspaces/[workspace]/evals/[evalName]/improve/route.ts");
  assert.ok(improve.indexOf("refuseAssistantJob(") > 0 && improve.indexOf("refuseAssistantJob(") < improve.indexOf("proposeNow("), "improve checks before it queues the draft");
  const assistant = read("../app/api/workspaces/[workspace]/assistant/route.ts");
  assert.ok(assistant.indexOf("refuseAssistantJob(") > 0 && assistant.indexOf("refuseAssistantJob(") < assistant.indexOf("enqueueAssistantJob(job)"), "the assistant route uses the same function");
  assert.doesNotMatch(assistant, /assertFunds|PLATFORM_PER_DAY = /, "no second copy of the brakes in the route");
});
