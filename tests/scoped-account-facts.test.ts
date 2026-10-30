// What a member or key limited to some workspaces reads of the ACCOUNT
// (owner decision and review, 30 Oct 2026):
//  - GET /api/account and GET /api/account/jobs: that notify: and telemetry:
//    are set, never the webhook URL, the collector, its headers or a token;
//  - GET /api/account/api: not the account's API use (who calls what);
//  - GET /api/avatars/workspace/<ws>: only a workspace it may open;
//  - GET /api/me/onboarding: no other workspace's name;
//  - GET /api/usage: not the wallet's ledger or the waivers;
//  - GET /api/workspaces/<ws>/vocabulary: the workspace's secret names, not
//    the account's (as GET /api/secrets lists them).
// A caller with every workspace reads all of it, as before.
//
//   node --import ./tests/register.mjs --test tests/scoped-account-facts.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-scoped-facts-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_SECRET_KEY = "scoped-facts-test-key";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const HOOK = "https://hooks.slack.com/services/T000/B000/sekrit-token";
const COLLECTOR = "https://otel.example.com/v1/traces";
const files: Record<string, string> = {
  "acme/AGENTS.md": `---\nname: acme\nnotify:\n  url: ${HOOK}\n  email: ops@acme.test\n  events: [failed]\ntelemetry:\n  otlp: ${COLLECTOR}\n  headers:\n    authorization: \${OTEL_TOKEN}\nalerts:\n  failure_rate: 30%\n---\n`,
  "acme/workspaces/aaa-hidden/AGENTS.md": "---\nname: aaa-hidden\n---\n",
  "acme/workspaces/mine/AGENTS.md": "---\nname: mine\n---\n",
};
for (const [p, body] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(DATA, p)), { recursive: true });
  fs.writeFileSync(path.join(DATA, p), body);
}

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { setSecret } = await import("../../foldrun-core/src/secrets.ts");
const { setAvatar } = await import("@/platform/avatars");
const accountRoute = await import("../app/api/account/route.ts");
const jobsRoute = await import("../app/api/account/jobs/route.ts");
const apiRoute = await import("../app/api/account/api/route.ts");
const avatarRoute = await import("../app/api/avatars/[kind]/[id]/route.ts");
const onboardingRoute = await import("../app/api/me/onboarding/route.ts");
const usageRoute = await import("../app/api/usage/route.ts");
const vocabularyRoute = await import("../app/api/workspaces/[workspace]/vocabulary/route.ts");

const { key: everyWs } = await createApiKey("acme", "all", "admin@acme.test", undefined, "admin");
const { key: oneWs } = await createApiKey("acme", "one desk", "desk@acme.test", undefined, "viewer", ["mine"]);

const call = (key: string, url: string) => new NextRequest(`http://x${url}`, { headers: { authorization: `Bearer ${key}` } });
const text = async (res: Response) => {
  assert.equal(res.status, 200, `${res.status}`);
  return res.text();
};

test("GET /api/account: a scoped caller learns notify and telemetry are set, never where they go", async () => {
  const full = JSON.parse(await text(await accountRoute.GET(call(everyWs, "/api/account")))) as { defaults: { notify: { url: string }; telemetry: { endpoint: string } } };
  assert.equal(full.defaults.notify.url, HOOK);
  assert.equal(full.defaults.telemetry.endpoint, COLLECTOR);

  const body = await text(await accountRoute.GET(call(oneWs, "/api/account")));
  assert.doesNotMatch(body, /sekrit|hooks\.slack|otel\.example|OTEL_TOKEN|authorization/);
  const scoped = JSON.parse(body) as { defaults: { notify: { hidden?: boolean; url?: string; events: string[] }; telemetry: { hidden?: boolean }; alerts: unknown } };
  assert.equal(scoped.defaults.notify.hidden, true);
  assert.equal(scoped.defaults.notify.url, undefined);
  assert.deepEqual(scoped.defaults.notify.events, ["failed"]);
  assert.equal(scoped.defaults.telemetry.hidden, true);
  assert.ok(scoped.defaults.alerts, "alerts are thresholds, no destination: still shown");
});

test("GET /api/account/jobs: the same for the four jobs' account values", async () => {
  const full = await text(await jobsRoute.GET(call(everyWs, "/api/account/jobs")));
  assert.match(full, /sekrit-token/);
  assert.match(full, /otel\.example\.com/);
  const body = await text(await jobsRoute.GET(call(oneWs, "/api/account/jobs?workspace=mine")));
  assert.doesNotMatch(body, /sekrit|hooks\.slack|otel\.example|OTEL_TOKEN/);
  const fields = (JSON.parse(body) as { jobs: { fields: { key: string; account: unknown }[] }[] }).jobs.flatMap((j) => j.fields);
  assert.deepEqual(fields.find((f) => f.key === "telemetry")?.account, { hidden: true });
  assert.deepEqual(fields.find((f) => f.key === "notify")?.account, { email: "ops@acme.test", events: ["failed"], hidden: true });
});

test("GET /api/account/api: the account's API use only to a caller with every workspace", async () => {
  const full = JSON.parse(await text(await apiRoute.GET(call(everyWs, "/api/account/api")))) as { usageHidden?: boolean };
  assert.equal(full.usageHidden, undefined);
  const scoped = JSON.parse(await text(await apiRoute.GET(call(oneWs, "/api/account/api")))) as { usage: unknown; usageHidden?: boolean; version: unknown };
  assert.equal(scoped.usage, null);
  assert.equal(scoped.usageHidden, true);
  assert.ok(scoped.version, "the version and limits are still answered");
});

test("GET /api/avatars/workspace/<ws>: only a workspace the caller may open", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  setAvatar("acme", "workspace", "aaa-hidden", png);
  setAvatar("acme", "workspace", "mine", png);
  const get = (key: string, id: string) => avatarRoute.GET(call(key, `/api/avatars/workspace/${id}`), { params: Promise.resolve({ kind: "workspace", id }) });
  assert.equal((await get(oneWs, "aaa-hidden")).status, 403);
  assert.equal((await get(oneWs, "nothing-here")).status, 403, "the same answer whether or not it has a picture");
  assert.equal((await get(oneWs, "mine")).status, 200);
  assert.equal((await get(everyWs, "aaa-hidden")).status, 200);
});

test("GET /api/me/onboarding: a scoped caller's steps name only its own workspaces", async () => {
  const full = await text(await onboardingRoute.GET(call(everyWs, "/api/me/onboarding")));
  assert.match(full, /aaa-hidden/, "the account's first workspace, to a caller with all");
  const scoped = await text(await onboardingRoute.GET(call(oneWs, "/api/me/onboarding")));
  assert.doesNotMatch(scoped, /aaa-hidden/);
  assert.match(scoped, /\/dashboard\/mine\//);
});

test("GET /api/usage: the ledger and the waivers only to a caller with every workspace", async () => {
  const full = JSON.parse(await text(await usageRoute.GET(call(everyWs, "/api/usage")))) as { ledger: unknown; waived: unknown };
  assert.ok(full.ledger && typeof full.ledger === "object");
  assert.ok(Array.isArray(full.waived));
  const scoped = JSON.parse(await text(await usageRoute.GET(call(oneWs, "/api/usage")))) as { ledger: unknown; waived: unknown; workspaces: { workspace: string }[] };
  assert.equal(scoped.ledger, null);
  assert.equal(scoped.waived, null);
  assert.deepEqual(scoped.workspaces.map((w) => w.workspace), ["mine"]);
});

test("GET …/vocabulary: the account's secret names only to a caller with every workspace", async () => {
  setSecret("acme", "STRIPE_LIVE_KEY", "sk_live_x");
  setSecret("acme", "DESK_TOKEN", "t", "mine");
  const vocab = async (key: string) =>
    JSON.parse(await text(await vocabularyRoute.GET(call(key, "/api/workspaces/mine/vocabulary"), { params: Promise.resolve({ workspace: "mine" }) }))) as { secrets: string[] };
  assert.deepEqual((await vocab(everyWs)).secrets.sort(), ["DESK_TOKEN", "STRIPE_LIVE_KEY"]);
  assert.deepEqual((await vocab(oneWs)).secrets, ["DESK_TOKEN"]);
});

// Not a scope read, but the same review (30 Oct 2026): erasing a run's
// record is workspace:manage (an admin), not run:start (an editor) — an
// editor could wipe the trail of a run they started.
test("DELETE …/runs/<id>: an editor is refused, an admin passes the gate", async () => {
  const runRoute = await import("../app/api/workspaces/[workspace]/runs/[runId]/route.ts");
  const { key: editor } = await createApiKey("acme", "ed", "ed@acme.test", undefined, "editor");
  const del = (key: string) =>
    runRoute.DELETE(new NextRequest("http://x/api/workspaces/mine/runs/run-nope", { method: "DELETE", headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ workspace: "mine", runId: "run-nope" }) });
  const refused = await del(editor);
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /admin/);
  assert.equal((await del(everyWs)).status, 404, "past the gate: there is no such run");
});
