// The customer's audit log: GET /api/audit reads one account's entries —
// the caller's, never another's — for the owner and unscoped admins (people
// or keys), with filters, a cursor and CSV. And the security-relevant acts
// write their line: keys, secrets by name, deploys, workspace deletes.
//
//   node --import ./tests/register.mjs --test tests/audit-log.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-audit-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_RESEND_API_KEY;
process.env.FOLDRUN_SECRET_KEY ??= "a".repeat(64);

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { createAccountBySuperAdmin } = await import("../server/users.ts");
const auditRoute = await import("../app/api/audit/route.ts");
const keysRoute = await import("../app/api/keys/route.ts");
const secretsRoute = await import("../app/api/secrets/route.ts");
const { audit, auditCsv, queryAudit } = await import("../server/audit.ts");

await createAccountBySuperAdmin("owner@acme.test", "correct horse battery staple 9", "acme");
await createAccountBySuperAdmin("owner@globex.test", "correct horse battery staple 9", "globex");
const { key: acmeAdmin } = await createApiKey("acme", "ops", "owner@acme.test", undefined, "admin");
const { key: acmeEditor } = await createApiKey("acme", "ci", "owner@acme.test", undefined, "editor");
const { key: acmeScoped } = await createApiKey("acme", "one-ws", "owner@acme.test", undefined, "admin", ["leads"]);
const { key: globexAdmin } = await createApiKey("globex", "ops", "owner@globex.test", undefined, "admin");

const call = (key: string, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://x${url}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const read = async (key: string, qs = "", headers: Record<string, string> = {}) => auditRoute.GET(call(key, `/api/audit${qs}`, { headers }));

test("key mint and secret writes are recorded — the secret by name, never its value", async () => {
  assert.equal((await keysRoute.POST(call(acmeAdmin, "/api/keys", { method: "POST", body: { label: "laptop", role: "viewer", expires: "30d" } }))).status, 200);
  assert.equal((await secretsRoute.PUT(call(acmeAdmin, "/api/secrets", { method: "PUT", body: { name: "CRM_TOKEN", value: "sk-very-secret-value" } }))).status, 200);
  assert.equal((await secretsRoute.DELETE(call(acmeAdmin, "/api/secrets", { method: "DELETE", body: { name: "CRM_TOKEN" } }))).status, 200);
  assert.equal((await keysRoute.POST(call(globexAdmin, "/api/keys", { method: "POST", body: { label: "globex-only" } }))).status, 200);

  const res = await read(acmeAdmin);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { entries: { action: string; actor: string; detail: Record<string, unknown> }[]; retention: string };
  const actions = body.entries.map((e) => e.action);
  assert.ok(actions.includes("apikey.created"));
  assert.ok(actions.includes("secret.set"));
  assert.ok(actions.includes("secret.deleted"));
  const minted = body.entries.find((e) => e.action === "apikey.created")!;
  assert.equal(minted.detail.label, "laptop");
  assert.ok(String(minted.detail.expiresAt).length > 0, "the expiry is on the record");
  assert.equal(minted.actor, "owner@acme.test", "a key minted by a person is attributed to them");
  assert.doesNotMatch(JSON.stringify(body), /sk-very-secret-value/, "a secret's value never reaches the log");
  assert.match(body.retention, /life of the account/);
});

test("tenant isolation: one account never reads another's rows, whatever the request names", async () => {
  const res = await read(acmeAdmin, "?tenant=globex", { "x-foldrun-tenant": "globex" });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(text, /globex/, "globex's entries are not in acme's log");
  const theirs = await (await read(globexAdmin)).json() as { entries: { detail: Record<string, unknown> }[] };
  assert.ok(theirs.entries.some((e) => e.detail.label === "globex-only"));
  assert.doesNotMatch(JSON.stringify(theirs), /CRM_TOKEN|laptop/);
});

test("only the owner and unscoped admins: an editor key and a workspace-scoped admin key are refused", async () => {
  assert.equal((await read(acmeEditor)).status, 403);
  const scoped = await read(acmeScoped);
  assert.equal(scoped.status, 403);
  assert.match(((await scoped.json()) as { error: string }).error, /whole account/);
  assert.equal((await auditRoute.GET(new NextRequest("http://x/api/audit"))).status, 401);
});

test("filters, cursor paging and CSV", async () => {
  const only = (await (await read(acmeAdmin, "?action=secret")).json()) as { entries: { action: string }[] };
  assert.ok(only.entries.length >= 2);
  assert.ok(only.entries.every((e) => e.action.startsWith("secret.")));
  const exact = (await (await read(acmeAdmin, "?action=secret.deleted")).json()) as { entries: { action: string }[] };
  assert.deepEqual(exact.entries.map((e) => e.action), ["secret.deleted"]);

  const p1 = (await (await read(acmeAdmin, "?limit=1")).json()) as { entries: { id: string }[]; next: string | null };
  assert.equal(p1.entries.length, 1);
  assert.ok(p1.next);
  const p2 = (await (await read(acmeAdmin, `?limit=1&cursor=${p1.next}`)).json()) as { entries: { id: string }[] };
  assert.equal(p2.entries.length, 1);
  assert.notEqual(p2.entries[0].id, p1.entries[0].id, "the next page starts after the last one");

  const future = (await (await read(acmeAdmin, "?since=2999-01-01")).json()) as { entries: unknown[] };
  assert.equal(future.entries.length, 0);
  assert.equal((await read(acmeAdmin, "?since=yesterday-ish")).status, 400);
  assert.equal((await read(acmeAdmin, "?limit=0")).status, 400);

  const csv = await read(acmeAdmin, "?format=csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="audit-acme-/);
  const text = await csv.text();
  assert.match(text.split("\n")[0], /^id,at,actor,action,subject,workspace,detail$/);
  assert.match(text, /secret\.set/);
});

test("CSV neutralises a formula and quotes what needs it", () => {
  const out = auditCsv([{ id: "1", at: "2026-10-01T00:00:00.000Z", actor: "=HYPERLINK(1)", action: "x", subject: "a,b", detail: { workspace: "w" } }]);
  assert.match(out, /'=HYPERLINK\(1\)/);
  assert.match(out, /"a,b"/);
});

test("the super admin's operator.* levers are the platform's record, not the customer's", async () => {
  await audit("operator.notes" as never, { actor: "boss@foldrun.test", tenant: "acme", detail: { notes: "internal" } });
  const page = await queryAudit({ tenant: "acme", limit: 1000 });
  assert.ok(page.entries.every((e) => !e.action.startsWith("operator.")));
});
