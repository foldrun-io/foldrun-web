// GET /api/usage/budget: spend against the caps the Spend limits page shows
// — the account's budget: and each workspace's, each measured in its own
// window — through the route handler. A caller scoped to some workspaces
// sees those, and not the account's figure (spend over every workspace).
//
//   node --import ./tests/register.mjs --test tests/usage-budget.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-usage-budget-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { createApiKey } = await import("../server/auth.ts");
const { createUser } = await import("../server/users.ts");
const { append } = await import("@/platform/ledger");
const { accountDir, workspaceDir } = await import("@/lib/store");
const route = await import("../app/api/usage/budget/route.ts");

const tenant = "budget-co";
const owner = await createUser("owner@budget.test", "a long and unusual passphrase 42!", tenant);
const write = (dir: string, front: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\n${front}\n---\n\nContext.\n`);
};
write(accountDir(tenant), "budget: 500");
write(workspaceDir(tenant, "desk"), "budget: 60/day");
write(workspaceDir(tenant, "quiet"), "description: no cap");
write(workspaceDir(tenant, "other"), "budget: 100/week");

const now = new Date().toISOString();
const long = "2020-01-01T00:00:00.000Z";
await append(tenant, { t: now, kind: "run", usd: -12.5, workspace: "desk", flow: "daily", runId: "r1" });
await append(tenant, { t: long, kind: "run", usd: -40, workspace: "desk", flow: "daily", runId: "r0" });
await append(tenant, { t: now, kind: "run", usd: -3, workspace: "other", flow: "x", runId: "r2" });
await append(tenant, { t: now, kind: "topup", usd: 100, note: "credit" });

const key = async (role: "viewer" | "admin", workspaces: string[] | null = null) => (await createApiKey(tenant, "k", owner.email, undefined, role, workspaces)).key;
const get = (k: string | null) => route.GET(new NextRequest("http://localhost/api/usage/budget", { headers: k ? { authorization: `Bearer ${k}` } : {} }));

type Standing = { budget: { usd: number; period: string } | null; label: string | null; spentUsd: number; window: string };
type Body = { account: Standing | null; accountHidden?: boolean; workspaces: (Standing & { workspace: string })[] };

test("a viewer with every workspace sees the account's cap and each workspace's, spent in each one's window", async () => {
  const r = await get(await key("viewer"));
  assert.equal(r.status, 200, await r.clone().text());
  const body = (await r.json()) as Body;
  assert.deepEqual(body.account, { budget: { usd: 500, period: "month" }, label: "$500/month", spentUsd: 15.5, window: "this month" });
  assert.equal(body.accountHidden, undefined);
  assert.deepEqual(body.workspaces.map((w) => w.workspace), ["desk", "other", "quiet"], "most spent first");
  const desk = body.workspaces[0];
  assert.deepEqual(desk.budget, { usd: 60, period: "day" });
  assert.equal(desk.window, "today");
  assert.equal(desk.spentUsd, 12.5, "only today's charge counts against a daily cap");
  const quiet = body.workspaces.find((w) => w.workspace === "quiet")!;
  assert.equal(quiet.budget, null);
  assert.equal(quiet.label, null);
  assert.equal(quiet.window, "this month", "no cap: the month's spend, for the number alone");
});

test("a key scoped to one workspace sees that one, and not the account's figure", async () => {
  const r = await get(await key("admin", ["other"]));
  assert.equal(r.status, 200, await r.clone().text());
  const body = (await r.json()) as Body;
  assert.equal(body.account, null);
  assert.equal(body.accountHidden, true);
  assert.deepEqual(body.workspaces.map((w) => w.workspace), ["other"]);
  assert.equal(body.workspaces[0].label, "$100/week");
  assert.equal(body.workspaces[0].spentUsd, 3);
});

test("no caller: refused", async () => {
  assert.equal((await get(null)).status, 401);
});
