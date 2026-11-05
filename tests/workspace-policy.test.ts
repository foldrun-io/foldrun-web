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
const { changedPolicyKeys, changedFlowPublications } = await import("../server/workspace-policy.ts");
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

// A flow's `a2a:` — publishing it to outside agents over A2A (1 Nov 2026) —
// is the workspace's policy too, on every door: here the deploy, the one
// that replaces the whole tree.
test("a2a: on a flow — an editor's deploy may not publish, change or unpublish one; removing the flow is allowed", async () => {
  const published = { path: "flows/publish.md", content: FLOW.content.replace("trigger: manual\n", "trigger: manual\na2a:\n  publish: true\n") };
  assert.deepEqual(changedFlowPublications("acme", "desk", [published], "merge"), ["flows/publish.md"]);
  assert.deepEqual(changedFlowPublications("acme", "desk", [FLOW], "merge"), [], "the flow as it is");
  assert.deepEqual(changedFlowPublications("acme", "desk", [{ path: "knowledge/a2a.md", content: "---\na2a:\n  publish: true\n---\n" }], "merge"), [], "only a flow file publishes");
  const refused = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", editor, { files: [{ path: "AGENTS.md", content: POLICY }, AGENT, published] }), ctx);
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as { error: string }).error, /a2a: in flows\/publish\.md/);
  assert.equal((await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", admin, { files: [{ path: "AGENTS.md", content: POLICY }, AGENT, published] }), ctx)).status, 200);
  // Published now: an editor's change to the block, or taking it out, is refused…
  const unpublished = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", editor, { files: [{ path: "AGENTS.md", content: POLICY }, AGENT, FLOW] }), ctx);
  assert.equal(unpublished.status, 403);
  // …the prose around it is not, and neither is dropping the flow (less open, never more).
  const reworded = { ...published, content: published.content.replace("write it", "write it well") };
  assert.deepEqual(changedFlowPublications("acme", "desk", [reworded], "replace"), []);
  assert.deepEqual(changedFlowPublications("acme", "desk", [{ path: "AGENTS.md", content: POLICY }, AGENT], "replace"), [], "a flow the deploy removes is not a publication change");
  reset();
});

// remotes: cards at internal addresses (FOL-114): refused at save on an
// install that guards untrusted URLs, for every role and every door; a card
// the file already had is left to the run, which refuses it too.
const { registerPlatform, platform } = await import("@/lib/platform");
async function guarded(fn: () => Promise<void>) {
  const before = platform.fetchUntrusted;
  registerPlatform({ fetchUntrusted: (url, init) => fetch(url, init) });
  try {
    await fn();
  } finally {
    registerPlatform({ fetchUntrusted: before });
  }
}
const withRemote = (card: string) => ({
  path: "agents/caller/agent.md",
  content: `---\nname: caller\ndescription: calls\nremotes:\n  - name: checker\n    card: ${card}\n---\n\nCall it.\n`,
});

test("remotes: a card at an internal address is refused at save on a guarded install — by PUT /source and a deploy, admin or not", () =>
  guarded(async () => {
    const callerFile = path.join(workspaceDir("acme", "desk"), "agents/caller/agent.md");
    for (const card of ["https://127.0.0.1:3000/.well-known/agent-card.json", "https://169.254.169.254/latest/", "https://foldrun-web.foldrun.svc.cluster.local/x", "https://localhost/.well-known/agent-card.json"]) {
      const put = await source.PUT(json("/api/workspaces/desk/source", "PUT", admin, withRemote(card)), ctx);
      assert.equal(put.status, 400, card);
      assert.match(((await put.json()) as { error: string }).error, /does not call private or internal addresses — remotes: agents\/caller\/agent\.md: checker/, card);
      assert.equal(fs.existsSync(callerFile), false, `${card}: nothing written`);
    }
    const dep = await deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", admin, { files: [...tree(POLICY), withRemote("https://10.0.0.7/card")] }), ctx);
    assert.equal(dep.status, 400);
    // A public card saves.
    assert.equal((await source.PUT(json("/api/workspaces/desk/source", "PUT", editor, withRemote("https://agents.example.com/.well-known/agent-card.json")), ctx)).status, 200);
    fs.rmSync(path.dirname(callerFile), { recursive: true, force: true });
  }));

test("remotes: a card the file already had does not block an unrelated edit; a laptop keeps its localhost card", async () => {
  // Written before the check (or on a laptop): the file holds an internal card.
  const legacy = withRemote("https://127.0.0.1:3000/.well-known/agent-card.json");
  assert.equal((await source.PUT(json("/api/workspaces/desk/source", "PUT", admin, legacy), ctx)).status, 200, "not guarded: allowed");
  await guarded(async () => {
    const edited = { ...legacy, content: legacy.content.replace("Call it.", "Call it, politely.") };
    assert.equal((await source.PUT(json("/api/workspaces/desk/source", "PUT", editor, edited), ctx)).status, 200);
  });
  fs.rmSync(path.join(workspaceDir("acme", "desk"), "agents/caller"), { recursive: true, force: true });
});

// ── FOL-112: the agents behind a flow published over A2A ───────────────────
// N2: an editor may not widen what they may reach (tools, secrets, network,
// hooks, a new agent behind the flow), by any door; an admin may, audited.
// N1: nobody publishes a flow whose agent holds a secret and runs code
// unless an admin names it in a2a: accept_risk, audited.

const sourceRoutes = (await import("../app/api/workspaces/[workspace]/source/route.ts")) as unknown as { PUT: Handler; DELETE: Handler; PATCH: Handler };
const auditLines = (): { action: string; actor: string; detail: Record<string, unknown> }[] => {
  const file = path.join(process.env.FOLDRUN_DATA!, "audit", "acme.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const PUB_FLOW = { path: "flows/publish.md", content: "---\nname: publish\ntrigger: manual\na2a:\n  publish: true\n---\n\n1. [[writer]] — write it\n" };
const writer = (front: string) => ({ path: "agents/writer/agent.md", content: `---\nname: writer\ndescription: writes\n${front}---\n\nWrite.\n` });
const POLICY_HOOKED = POLICY.replace("budget: 50\n", "budget: 50\nhooks: [guard]\n");
const publishedTree = (agent = writer("tools: [read]\n"), agentsMd = POLICY_HOOKED) => [{ path: "AGENTS.md", content: agentsMd }, agent, PUB_FLOW];
const resetPublished = (agent?: { path: string; content: string }, agentsMd?: string) =>
  assert.ok(deployWorkspace("acme", "desk", publishedTree(agent, agentsMd), { by: "admin@acme.test", message: "reset" }).applied);
const errorOf = async (res: Response) => (await res.json()) as { error: string; code?: string };

test("N2: an editor's save that widens an agent of a published flow is refused, naming it; an admin's goes through and is audited", async () => {
  resetPublished();
  const wider = writer("tools: [read, write]\n");
  const refused = await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", editor, wider), ctx);
  assert.equal(refused.status, 403);
  const body = await errorOf(refused);
  assert.equal(body.code, "a2a_widening");
  assert.match(body.error, /widen what writer behind publish \(tools Edit, Write\) may reach/);
  assert.match(body.error, /your role is editor/);
  // Prose, and a narrower agent, are an editor's still.
  const reworded = writer("tools: [read]\n");
  assert.equal((await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", editor, { ...reworded, content: reworded.content.replace("Write.", "Write well.") }), ctx)).status, 200, "prose");
  assert.equal((await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", editor, writer("")), ctx)).status, 200, "narrower");
  const before = auditLines().length;
  assert.equal((await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", admin, wider), ctx)).status, 200);
  const line = auditLines().slice(before).find((l) => l.action === "a2a.agent_widened");
  assert.ok(line, "audited");
  assert.equal(line!.actor, "admin@acme.test");
  assert.deepEqual(line!.detail, { workspace: "desk", flow: "publish", agent: "writer", widened: ["tools Edit, Glob, Grep, Read, Write"] });
  resetPublished();
});

test("N2: by a deploy too — and a new agent behind the flow, the workspace's network: or a dropped hook all count", async () => {
  resetPublished();
  const deploy = (key: string, files: { path: string; content: string }[], extra: Record<string, unknown> = {}) =>
    deployRoute.POST(json("/api/workspaces/desk/deploy", "POST", key, { files, ...extra }), ctx);
  const secret = await deploy(editor, publishedTree(writer("tools: [read]\nsecrets: [CRM_TOKEN]\n")));
  assert.equal(secret.status, 403);
  assert.match((await errorOf(secret)).error, /writer behind publish \(secrets CRM_TOKEN\)/);
  const step = await deploy(editor, [...publishedTree(), { path: "agents/poster/agent.md", content: "---\nname: poster\n---\n\nPost.\n" }, { ...PUB_FLOW, content: PUB_FLOW.content + "2. [[poster]] — post it\n" }].filter((f, i, all) => all.findLastIndex((g) => g.path === f.path) === i));
  assert.equal(step.status, 403, "a step with another agent widens the published flow");
  assert.match((await errorOf(step)).error, /poster behind publish/);
  const net = await deploy(editor, publishedTree(undefined, POLICY_HOOKED.replace("name: desk\n", "name: desk\nnetwork: open\n")));
  assert.equal(net.status, 403, "the workspace's network: reaches every agent");
  assert.match((await errorOf(net)).error, /network trusted → open/);
  const unhooked = await deploy(editor, publishedTree(undefined, POLICY));
  assert.equal(unhooked.status, 403);
  assert.match((await errorOf(unhooked)).error, /hooks removed: guard/);
  // The dry run says so before anything is sent for real.
  const dry = await deploy(editor, publishedTree(writer("tools: [read, code]\n")), { dryRun: true });
  assert.equal(dry.status, 200);
  const plan = (await dry.json()) as { ok: boolean; policy?: { status: number; code: string } };
  assert.equal(plan.ok, false);
  assert.deepEqual([plan.policy?.status, plan.policy?.code], [403, "a2a_widening"]);
  // A deploy that leaves the agents as they are is not refused.
  assert.equal((await deploy(editor, publishedTree())).status, 200);
  resetPublished();
});

test("N2: removing AGENTS.md (its hooks:) widens; removing the flow does not", async () => {
  resetPublished();
  const del = (key: string, p: string) => sourceRoutes.DELETE(json("/api/workspaces/desk/source", "DELETE", key, { path: p }), ctx);
  const gone = await del(editor, "AGENTS.md");
  assert.equal(gone.status, 403);
  assert.match((await errorOf(gone)).error, /hooks removed: guard/);
  assert.equal((await del(editor, "flows/publish.md")).status, 200, "unpublishing by removal is less open, never more");
  resetPublished();
});

test("N1: publishing a flow whose agent holds a secret and runs code is refused without accept_risk — admin or not; with it, audited", async () => {
  const risky = writer("tools: [read, code]\nsecrets: [CRM_TOKEN]\n");
  assert.ok(deployWorkspace("acme", "desk", [{ path: "AGENTS.md", content: POLICY }, risky, FLOW], { by: "admin@acme.test", message: "reset" }).applied);
  const refused = await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", admin, PUB_FLOW), ctx);
  assert.equal(refused.status, 400);
  const body = await errorOf(refused);
  assert.equal(body.code, "a2a_secret_code");
  assert.match(body.error, /writer holds CRM_TOKEN and can run code \(Bash\), and publish is published over A2A — its answer goes back to the outside caller/);
  assert.match(body.error, /a2a: accept_risk: \[writer\] in publish/);
  const stale = await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", admin, { ...PUB_FLOW, content: PUB_FLOW.content.replace("publish: true\n", "publish: true\n  accept_risk: [writer, ghost]\n") }), ctx);
  assert.equal(stale.status, 400);
  assert.equal((await errorOf(stale)).code, "a2a_accept_risk");
  const before = auditLines().length;
  const accepted = { ...PUB_FLOW, content: PUB_FLOW.content.replace("publish: true\n", "publish: true\n  accept_risk: [writer]\n") };
  assert.equal((await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", admin, accepted), ctx)).status, 200);
  const line = auditLines().slice(before).find((l) => l.action === "a2a.risk_accepted");
  assert.deepEqual(line?.detail, { workspace: "desk", flow: "publish", agent: "writer", secrets: ["CRM_TOKEN"], runsCode: true });
  // The admin's ack does not let an editor widen the agent further.
  assert.equal((await sourceRoutes.PUT(json("/api/workspaces/desk/source", "PUT", editor, writer("tools: [read, code, write]\nsecrets: [CRM_TOKEN]\n")), ctx)).status, 403);
  reset();
});

test("DELETE /source of AGENTS.md drops its policy keys: an editor is refused, as team-and-access.md says", async () => {
  reset();
  const gone = await sourceRoutes.DELETE(json("/api/workspaces/desk/source", "DELETE", editor, { path: "AGENTS.md" }), ctx);
  assert.equal(gone.status, 403);
  assert.match((await errorOf(gone)).error, /this would change budget:, notify:, network_enforce: in desk's AGENTS\.md/);
  assert.equal(agentsMd(), POLICY, "nothing removed");
  assert.equal((await sourceRoutes.DELETE(json("/api/workspaces/desk/source", "DELETE", editor, { path: "knowledge/nothing.md" }), ctx)).status !== 403, true, "another file is not policy");
  reset();
});

test("N2: the agent editor's PATCH (a tool, a network, sandbox: own) is a door too", async () => {
  resetPublished();
  type AgentHandler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; agent: string }> }) => Promise<Response>;
  const agentRoute = (await import("../app/api/workspaces/[workspace]/agents/[agent]/route.ts")) as unknown as { PATCH: AgentHandler };
  const actx = { params: Promise.resolve({ workspace: "desk", agent: "writer" }) };
  const patch = (key: string, body: unknown) => agentRoute.PATCH(json("/api/workspaces/desk/agents/writer", "PATCH", key, body), actx);
  const tool = await patch(editor, { list: { key: "tools", name: "code", action: "add" } });
  assert.equal(tool.status, 403);
  assert.match((await errorOf(tool)).error, /writer behind publish \(tools Bash\)/);
  assert.equal((await patch(editor, { network: { level: "open" } })).status, 403);
  assert.equal((await patch(editor, { set: { key: "sandbox", value: "own" } })).status, 403);
  assert.equal((await patch(editor, { list: { key: "tools", name: "read", action: "remove" } })).status, 200, "narrowing is an editor's");
  assert.equal((await patch(admin, { list: { key: "tools", name: "write", action: "add" } })).status, 200);
  resetPublished();
});
