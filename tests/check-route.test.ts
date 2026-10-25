// GET …/check: what `foldrun check` says about the deployed copy, as
// findings with rule ids — the deploy's rules and the scanner — and the
// narrowing the Checks page and a CI job use.
//
//   node --import ./tests/register.mjs --test tests/check-route.test.ts
//
// The credential is assembled at run time so gitleaks does not refuse the file.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-check-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/check/route.ts")) as unknown as { GET: Handler };

const TENANT = "acme";
const ws = path.join(DATA, TENANT, "workspaces", "desk");
const lib = path.join(DATA, TENANT, "library");
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const KEY = ["sk", "ant", "api03", crypto.randomBytes(24).toString("hex")].join("-");
write(ws, "AGENTS.md", "---\nname: desk\n---\n");
// The outward tool lives in the library: the route resolves it there, which
// the files alone could not.
write(lib, "tools/post_x/tool.md", "---\nname: post_x\ndescription: posts\noutward: true\ntransport: http\nbase: https://api.x.com\n---\n");
write(ws, "agents/poster/agent.md", "---\nname: poster\ndescription: posts\ntools: [read, post_x]\nsecrets: [X]\nnetwork: [api.x.com]\n---\n\nPost.\n");
write(ws, "agents/scout/agent.md", "---\nname: scout\ndescription: reads\ntools: [web]\nsecrets: [CRM]\n---\n\nRead.\n");
write(ws, "flows/go.md", "---\ntrigger: manual\n---\n\n1. [[scout]] — Read.\n");
write(ws, "knowledge/k.md", `---\ntype: Fact\n---\n\nKey: ${KEY}\n`);

const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const get = async (q = "", key: string | undefined = viewer) => {
  const res = await route.GET(
    new NextRequest(`http://localhost/api/workspaces/desk/check${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }),
    { params: Promise.resolve({ workspace: "desk" }) },
  );
  return { status: res.status, body: (await res.json()) as any };
};

test("a viewer reads the findings, with rule ids, levels and the rules they name", async () => {
  const { status, body } = await get();
  assert.equal(status, 200, JSON.stringify(body));
  const rules = body.findings.map((f: any) => `${f.rule} ${f.file}`);
  assert.ok(rules.includes("secret/hardcoded knowledge/k.md"), rules.join("\n"));
  assert.ok(rules.includes("security/lethal-trifecta agents/scout/agent.md"), rules.join("\n"));
  assert.ok(!JSON.stringify(body).includes(KEY), "the key never leaves in the answer");
  assert.equal(body.counts.warn, body.findings.filter((f: any) => f.level === "warn").length);
  assert.ok(body.rules.some((r: any) => r.id === "secret/hardcoded" && r.help));
});

test("?security=1 and ?rule= narrow it; no key is refused; an unknown workspace is a 404", async () => {
  const s = await get("?security=1");
  assert.ok(s.body.findings.length > 0 && s.body.findings.every((f: any) => /^(secret|security|content|supply-chain)\//.test(f.rule)));
  const r = await get("?rule=secret");
  assert.deepEqual(r.body.findings.map((f: any) => f.rule), ["secret/hardcoded"]);
  assert.equal((await get("", "")).status, 401);
  const res = await route.GET(
    new NextRequest("http://localhost/api/workspaces/nope/check", { headers: { authorization: `Bearer ${viewer}` } }),
    { params: Promise.resolve({ workspace: "nope" }) },
  );
  assert.equal(res.status, 404);
});

test("the editor and the route see the same findings: a library outward tool counts in both", async () => {
  const { workspaceCheck } = await import("../server/checks.ts");
  write(ws, "agents/leaker/agent.md", "---\nname: leaker\ndescription: reads and posts\ntools: [web, post_x]\nsecrets: [X]\nnetwork: trusted\n---\n\nGo.\n");
  const direct = workspaceCheck(TENANT, "desk").filter((f) => f.file === "agents/leaker/agent.md" && f.rule === "security/lethal-trifecta");
  assert.equal(direct.length, 1, "post_x is outward in the library, so the trusted network does not close the way out");
  const { body } = await get();
  assert.ok(body.findings.some((f: any) => f.file === "agents/leaker/agent.md" && f.rule === "security/lethal-trifecta"));
});
