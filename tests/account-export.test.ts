// GET /api/account/export is the customer's copy of their data, so a ledger
// line in it carries the charge and what it was for — not the platform's
// internals. `cost` and `agents` were always left out; since 30 Oct 2026
// so are `key` (the ledger's once-only dedup handle) and `pricingVersion`
// (the operator-settings snapshot a charge was priced at).
//
//   node --import ./tests/register.mjs --test tests/account-export.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-account-export-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";

const { NextRequest } = await import("next/server");
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const { append } = await import("@/platform/ledger");
const exportRoute = await import("../app/api/account/export/route.ts");

test("a ledger line in the export has no cost, agents, key or pricingVersion — and keeps the charge", async () => {
  const owner = await createUser("owner@export.test", "a long enough password 1", "export-co");
  const cookie = `${SESSION_COOKIE}=${(await mintSession(owner)).value}`;
  await append(owner.tenant, {
    t: "2026-10-30T01:00:00.000Z",
    kind: "run",
    usd: -0.25,
    cost: 0.1,
    agents: { writer: 0.25 },
    key: "run:run-123",
    pricingVersion: 7,
    workspace: "desk",
    runId: "run-123",
    flow: "daily",
    reason: "usage",
  });
  const res = await exportRoute.GET(new NextRequest("http://localhost/api/account/export", { headers: { cookie } }));
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { ledger: Record<string, unknown>[] };
  const line = body.ledger.find((l) => l.runId === "run-123");
  assert.ok(line, "the charge is there");
  assert.equal(line.usd, -0.25);
  assert.equal(line.flow, "daily");
  for (const internal of ["cost", "agents", "key", "pricingVersion"]) assert.ok(!(internal in line), `${internal} is left out`);
});
