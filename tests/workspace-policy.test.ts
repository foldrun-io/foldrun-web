// A workspace's policy keys — budget, notify, network_enforce, telemetry and
// the rest PATCH /api/workspaces/<ws> guards — are an admin's on every way
// into its AGENTS.md (server/workspace-policy.ts). Until 30 Oct 2026 an
// editor changed them through PUT /source, a deploy, an import or a restore,
// past the workspace:manage the settings PATCH asks for.
//
//   node --import ./tests/register.mjs --test tests/workspace-policy.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ws-policy-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { changedPolicyKeys } = await import("../server/workspace-policy.ts");
const { deployWorkspace } = await import("@/lib/deploy");
const { workspaceDir } = await import("@/lib/store");
const { headRevision } = await import("@/lib/history");
const { packageZip } = await import("@/lib/package");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const source = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as unknown as { PUT: Handler };
const deployRoute = (await import("../app/api/workspaces/[workspace]/deploy/route.ts")) as unknown as { POST: Handler };
const importRoute = (await import("../app/api/workspaces/[workspace]/import/route.ts")) as unknown as { POST: Handler };
const restoreRoute = (await import("../app/api/workspaces/[workspace]/restore/route.ts")) as unknown as { POST: Handler };

const { key: admin } = await createApiKey("acme", "ops", "admin@acme.test", undefined, "admin", null);
const { key: editor } = await createApiKey("acme", "ed", "ed@acme.test", undefined, "editor", null);

const ctx = { params: Promise.resolve({ workspace: "desk" }) };
const json = (url: string, method: string, key: string, body: unknown) =>
  new NextRequest(`http://x${url}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });

const POLICY = "---\nname: desk\nbudget: 50\nnetwork_enforce: true\nnotify:\n  url: https://hooks.example.com/desk\n  events: [failed]\n---\n\nA desk.\n";
const AGENT = { path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes\n---\n\nWrite.\n" };
const FLOW = { path: "flows/publish.md", content: "---\nname: publish\ntrigger: manual\n---\n\n1. [[writer]] — write it\n" };
const tree = (agentsMd: string) => [{ path: "AGENTS.md", content: agentsMd }, AGENT, FLOW];
const agentsMd = () => fs.readFileSync(path.join(workspaceDir("acme", "desk"), "AGENTS.md"), "utf8");
const reset = (text = POLICY) => assert.ok(deployWorkspace("acme", "desk", tree(text), { by: "admin@acme.test", message: "reset" }).applied);

reset();

test("changedPolicyKeys: added, removed and changed keys count; prose, other keys, key order and the job blocks do not", () => {
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("A desk.", "A different desk.")), []);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("name: desk", "name: desk\ndescription: x")), []);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("budget: 50\n", "")), ["budget"]);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("network_enforce: true", "network_enforce: false")), ["network_enforce"]);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("hooks.example.com", "attacker.example")), ["notify"]);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("  url: https://hooks.example.com/desk\n  events: [failed]", "  events: [failed]\n  url: https://hooks.example.com/desk")), []);
  assert.deepEqual(changedPolicyKeys(POLICY, POLICY.replace("budget: 50\n", "governance:\n  budget: 50\n")), [], "a job block is the same key");
  assert.deepEqual(changedPolicyKeys(null, "---\ntelemetry:\n  otlp: https://attacker.example\n---\n"), ["telemetry"]);
  // A file that does not parse configures nothing at run time: dropping the keys.
  assert.deepEqual(changedPolicyKeys(POLICY, "---\nbudget: [\n---\n").sort(), ["budget", "network_enforce", "notify"]);
});

test("PUT /source: an editor may edit AGENTS.md's prose, not its policy keys; an admin may", async () => {
  const lifted = POLICY.replace("budget: 50\n", "budget: 5000\n");
  const refused = await source.PUT(json("/api/workspaces/desk/source", "PUT", editor, { path: "AGENTS.md", content: lifted }), ctx);
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /budget:.*admin/);
  assert.equal(agentsMd(), POLICY);

  const prose = POLICY.replace("A desk.", "A desk that writes.");
  assert.equal((await source.PUT(json("/api/workspaces/desk/source", "PUT", editor, { path: "AGENTS.md", content: prose }), ctx)).status, 200);
  assert.match(agentsMd(), /A desk that writes\./);

  assert.equal((await source.PUT(json("/api/workspaces/desk/source", "PUT", admin, { path: "AGENTS.md", content: lifted }), ctx)).status, 200);
  assert.match(agentsMd(), /budget: 5000/);
  reset();
});

test("PUT /source: project.md is the config only where there is no AGENTS.md", async () => {
  // With AGENTS.md there, project.md configures nothing: an editor may write it.
  const shadowed = await source.PUT(json("/api/workspaces/desk/source", "PUT", editor, { path: "project.md", content: "---\nbudget: 9999\n---\n" }), ctx);
  assert.equal(shadowed.status, 200, await shadowed.clone().text());
  fs.rmSync(path.join(workspaceDir("acme", "desk"), "project.md"));
});

test("deploy: an editor's deploy that drops network_enforce is refused, nothing changes; one that keeps the keys goes through", async () => {
  const before = headRevision("acme", "desk")?.id;
  const res = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", editor, { files: tree(POLICY.replace("network_enforce: true\n", "")) }), ctx);
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as { error: string }).error, /network_enforce:/);
  assert.equal(agentsMd(), POLICY);
  assert.equal(headRevision("acme", "desk")?.id, before);

  // A deploy that carries no AGENTS.md removes it, and with it the policy.
  const without = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", editor, { files: [AGENT, FLOW] }), ctx);
  assert.equal(without.status, 403);

  const same = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", editor, { files: tree(POLICY.replace("A desk.", "Still a desk.")) }), ctx);
  assert.equal(same.status, 200, await same.clone().text());
  reset();
});

test("import with overwrite: an editor's package may not replace the policy keys", async () => {
  const pkg = {
    manifest: { format: "foldrun-package" as const, version: 1 as const, kind: "workspace" as const, name: "desk", workspace: "elsewhere", exportedAt: new Date().toISOString(), files: ["AGENTS.md"] },
    files: [{ path: "AGENTS.md", content: "---\nname: desk\n---\n\nNo budget here.\n" }],
  };
  const bytes = new Uint8Array(packageZip(pkg));
  const post = (key: string) =>
    importRoute.POST(
      new NextRequest("http://x/api/workspaces/desk/import?overwrite=1", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/zip", "content-length": String(bytes.length) }, body: bytes }),
      ctx,
    );
  const refused = await post(editor);
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /budget:, notify:, network_enforce:/);
  assert.equal(agentsMd(), POLICY);
  assert.equal((await post(admin)).status, 200);
  reset();
});

test("restore: an editor may not go back to before the policy was set; an admin may", async () => {
  reset("---\nname: desk\n---\n\nA desk.\n");
  const open = headRevision("acme", "desk")!.id;
  reset();
  const body = { to: open, confirm: "desk" };
  const refused = await restoreRoute.POST(json("/api/workspaces/desk/restore", "POST", editor, body), ctx);
  assert.equal(refused.status, 403);
  assert.equal(agentsMd(), POLICY);
  // The dry run writes nothing and stays open to an editor.
  assert.equal((await restoreRoute.POST(json("/api/workspaces/desk/restore", "POST", editor, { to: open, dryRun: true }), ctx)).status, 200);
  const done = await restoreRoute.POST(json("/api/workspaces/desk/restore", "POST", admin, body), ctx);
  assert.equal(done.status, 200, await done.clone().text());
  assert.doesNotMatch(agentsMd(), /budget/);
});
