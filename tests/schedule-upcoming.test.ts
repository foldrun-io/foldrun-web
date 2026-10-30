// GET /api/schedule: the next three fires come from the scheduler's own
// nextFire (hours, not 57,600 minutes), and a cron whose day never comes
// (`0 0 30 2 *`) is answered at once with none. 30 Oct 2026.
//
//   node --import ./tests/register.mjs --test tests/schedule-upcoming.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-schedule-upcoming-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const flow = (name: string, cron: string, tz = "UTC") =>
  `---\nname: ${name}\ntrigger: schedule\nschedule: "${cron}"\ntimezone: ${tz}\n---\n1. [[writer]] — write\n`;
const files: Record<string, string> = {
  "acme/workspaces/desk/AGENTS.md": "---\nname: desk\n---\n",
  "acme/workspaces/desk/agents/writer/agent.md": "---\nname: writer\n---\nwrite\n",
  "acme/workspaces/desk/flows/never.md": flow("never", "0 0 30 2 *"),
  "acme/workspaces/desk/flows/sydney.md": flow("sydney", "30 2 * * *", "Australia/Sydney"),
};
for (const [p, body] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(DATA, p)), { recursive: true });
  fs.writeFileSync(path.join(DATA, p), body);
}

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const route = await import("../app/api/schedule/route.ts");
const { parseCron, cronMatches } = await import("@/platform/scheduler");
const { key } = await createApiKey("acme", "viewer", "v@acme.test", undefined, "viewer");

/** The old answer, a minute at a time — what nextFire must agree with. */
function byMinutes(expr: string, tz: string, from: number, count = 3): string[] {
  const cron = parseCron(expr)!;
  const out: string[] = [];
  const start = Math.floor(from / 60_000) * 60_000;
  for (let i = 1; i <= 60 * 24 * 40 && out.length < count; i++) {
    const t = new Date(start + i * 60_000);
    if (cronMatches(cron, t, tz)) out.push(t.toISOString());
  }
  return out;
}

test("an impossible cron is valid with no upcoming fires, answered fast; a real one agrees with the minute scan", async () => {
  const before = Date.now();
  const t = performance.now();
  const res = await route.GET(new NextRequest("http://x/api/schedule", { headers: { authorization: `Bearer ${key}` } }));
  const took = performance.now() - t;
  assert.equal(res.status, 200);
  const { scheduled } = (await res.json()) as { scheduled: { flow: string; valid: boolean; upcoming: string[] }[] };
  const never = scheduled.find((s) => s.flow === "never")!;
  assert.equal(never.valid, true, "it parses — `valid` keeps meaning that");
  assert.deepEqual(never.upcoming, []);
  const sydney = scheduled.find((s) => s.flow === "sydney")!;
  assert.equal(sydney.upcoming.length, 3);
  // The minute scan from the same moment (give or take the minute the call took).
  const ref = byMinutes("30 2 * * *", "Australia/Sydney", before);
  assert.deepEqual(sydney.upcoming, ref);
  assert.ok(took < 2000, `answered in ${Math.round(took)} ms`);
});
