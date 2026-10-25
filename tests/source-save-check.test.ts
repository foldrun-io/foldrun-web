// FOL-57: every save answers with the deploy's checks for that file. With
// check: true (the dashboard editor) an error a deploy would refuse is refused
// (422, the issues, nothing written); without it — an older caller, or the
// editor's "Save anyway" — the save goes through as it always did. Files a
// deploy does not carry are not checked.
//
//   node --import ./tests/register.mjs --test tests/source-save-check.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-save-check-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const { PUT } = await import("../app/api/workspaces/[workspace]/source/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { deployWorkspace } = await import("@/lib/deploy");
const { workspaceDir } = await import("@/lib/store");

const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const put = async (body: Record<string, unknown>) => {
  const res = await PUT(
    new NextRequest("http://x/api/workspaces/desk/source", { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ workspace: "desk" }) },
  );
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; issues?: { level: string; rule: string; where: string; message: string }[] } };
};

deployWorkspace("acme", "desk", [
  { path: "AGENTS.md", content: "---\nname: desk\n---\n\nA desk.\n" },
  { path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes\n---\n\nWrite.\n" },
  { path: "flows/daily.md", content: "---\nname: daily\ntrigger: manual\n---\n\n1. [[writer]] — write\n" },
], { by: "a@b.c", message: "made" });
const file = (rel: string) => fs.readFileSync(path.join(workspaceDir("acme", "desk"), rel), "utf8");

test("with check: true, a save the deploy would refuse is refused with the issues, and nothing is written", async () => {
  const before = file("flows/daily.md");
  const r = await put({ path: "flows/daily.md", content: "---\nname: daily\ntrigger: manual\n---\n\n1. [[ghost]] — write\n", check: true });
  assert.equal(r.status, 422);
  assert.match(r.body.error ?? "", /^flows\/daily\.md did not check out — .*ghost/);
  assert.match(r.body.error ?? "", /save it anyway/);
  assert.ok(r.body.issues?.some((i) => i.level === "error" && i.where.startsWith("flows/daily.md")));
  assert.equal(file("flows/daily.md"), before, "nothing written");
});

test("without check — an older caller, or Save anyway — it saves as before, and says what is wrong", async () => {
  const r = await put({ path: "flows/daily.md", content: "---\nname: daily\ntrigger: manual\n---\n\n1. [[ghost]] — write\n" });
  assert.equal(r.status, 200);
  assert.ok(r.body.issues?.some((i) => i.level === "error"));
  assert.match(file("flows/daily.md"), /\[\[ghost\]\]/);
});

test("a good save goes through with no errors; a broken file elsewhere is not this save's business", async () => {
  const r = await put({ path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes well\n---\n\nWrite well.\n", check: true });
  assert.equal(r.status, 200, r.body.error ?? "");
  assert.deepEqual(r.body.issues?.filter((i) => i.level === "error"), []);
  const fixed = await put({ path: "flows/daily.md", content: "---\nname: daily\ntrigger: manual\n---\n\n1. [[writer]] — write\n", check: true });
  assert.equal(fixed.status, 200, fixed.body.error ?? "");
});

test("files a deploy does not carry are saved unchecked", async () => {
  const r = await put({ path: "state/cursor.json", content: "{ not json", check: true });
  assert.equal(r.status, 200, r.body.error ?? "");
  assert.deepEqual(r.body.issues, []);
});

test("a path spelled ./flows/x.md is checked as flows/x.md", async () => {
  const r = await put({ path: "./flows/daily.md", content: "---\nname: daily\ntrigger: manual\n---\n\n1. [[ghost]] — write\n", check: true });
  assert.equal(r.status, 422);
});
