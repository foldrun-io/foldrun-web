// An account secret limited to selected workspaces, through the API:
// PATCH /api/secrets { name, workspaces } (account-wide admins only), GET
// lists the list, a workspace off it resolves the secret as not set, and a
// rename or delete of a workspace carries the list along (30 Oct 2026).
//
//   node --import ./tests/register.mjs --test tests/secret-workspaces-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-secret-ws-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_STORAGE_DRIVER;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { getSecret, setSecret } = await import("../../foldrun-core/src/secrets.ts");
const secretsRoute = await import("../app/api/secrets/route.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const wsRoute = (await import("../app/api/workspaces/[workspace]/route.ts")) as unknown as { PATCH: Handler; DELETE: Handler };

for (const ws of ["sales", "ops", "blog"]) {
  const dir = path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", ws);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
}
const { key: admin } = await createApiKey("acme", "ops", "admin@acme.test", undefined, "admin", null);
const { key: scoped } = await createApiKey("acme", "desk", "desk@acme.test", undefined, "admin", ["sales"]);
const { key: editor } = await createApiKey("acme", "ed", "ed@acme.test", undefined, "editor", null);

const call = (key: string, url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const patch = (key: string, body: unknown) => secretsRoute.PATCH(call(key, "/api/secrets", "PATCH", body));
const listed = async () => ((await (await secretsRoute.GET(call(admin, "/api/secrets", "GET"))).json()) as { secrets: { name: string; workspaces?: string[] }[] }).secrets;

setSecret("acme", "STRIPE_KEY", "sk_live");

test("an account-wide admin limits an account secret; GET lists it; other workspaces find it not set", async () => {
  const res = await patch(admin, { name: "STRIPE_KEY", workspaces: ["sales", "ops"] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { workspaces: string[]; scope: string; sites?: unknown };
  assert.deepEqual(body.workspaces, ["ops", "sales"]);
  assert.equal(body.scope, "account");
  assert.equal(body.sites, undefined, "sites untouched and not answered when not sent");
  assert.deepEqual((await listed()).find((s) => s.name === "STRIPE_KEY")?.workspaces, ["ops", "sales"]);
  assert.equal(getSecret("acme", "STRIPE_KEY", "sales")?.value, "sk_live");
  assert.equal(getSecret("acme", "STRIPE_KEY", "blog"), null);
});

test("refused: a scoped admin, an editor, a workspace's own secret, an unknown workspace, a list that is not one", async () => {
  assert.equal((await patch(scoped, { name: "STRIPE_KEY", workspaces: null })).status, 403);
  assert.equal((await patch(editor, { name: "STRIPE_KEY", workspaces: null })).status, 403);
  assert.equal((await patch(admin, { name: "STRIPE_KEY", workspaces: ["sales"], workspace: "sales" })).status, 400);
  const unknown = await patch(admin, { name: "STRIPE_KEY", workspaces: ["sales", "nosuch"] });
  assert.equal(unknown.status, 400);
  assert.match(((await unknown.json()) as { error: string }).error, /no workspace nosuch/);
  assert.equal((await patch(admin, { name: "STRIPE_KEY", workspaces: "sales" })).status, 400);
  assert.equal((await patch(admin, { name: "STRIPE_KEY" })).status, 400);
  assert.equal((await patch(admin, { name: "NO_SUCH", workspaces: ["sales"] })).status, 404);
  assert.deepEqual((await listed()).find((s) => s.name === "STRIPE_KEY")?.workspaces, ["ops", "sales"], "nothing changed");
});

test("sites and workspaces in one call", async () => {
  const res = await patch(admin, { name: "STRIPE_KEY", sites: ["api.stripe.com"], workspaces: ["sales", "ops"] });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { sites: string[]; workspaces: string[] };
  assert.deepEqual(body.sites, ["api.stripe.com"]);
  assert.deepEqual(body.workspaces, ["ops", "sales"]);
});

test("renaming a workspace keeps its secrets; deleting one takes its name off the list", async () => {
  const renamed = await wsRoute.PATCH(call(admin, "/api/workspaces/ops", "PATCH", { name: "operations" }), { params: Promise.resolve({ workspace: "ops" }) });
  assert.equal(renamed.status, 200, await renamed.clone().text());
  assert.equal(getSecret("acme", "STRIPE_KEY", "operations")?.value, "sk_live");
  assert.deepEqual((await listed()).find((s) => s.name === "STRIPE_KEY")?.workspaces, ["operations", "sales"]);

  const gone = await wsRoute.DELETE(call(admin, "/api/workspaces/sales", "DELETE"), { params: Promise.resolve({ workspace: "sales" }) });
  assert.equal(gone.status, 200, await gone.clone().text());
  assert.deepEqual((await listed()).find((s) => s.name === "STRIPE_KEY")?.workspaces, ["operations"]);
});

test("PUT sets the value and the limit in one write, and never ignores a workspaces it was sent", async () => {
  const put = (key: string, body: unknown) => secretsRoute.PUT(call(key, "/api/secrets", "PUT", body));
  const made = await put(admin, { name: "CRM_KEY", value: "crm", workspaces: ["blog"] });
  assert.equal(made.status, 200, await made.clone().text());
  assert.deepEqual(((await made.json()) as { workspaces: string[] }).workspaces, ["blog"]);
  assert.equal(getSecret("acme", "CRM_KEY", "operations"), null);
  assert.equal(getSecret("acme", "CRM_KEY", "blog")?.value, "crm");
  // Refused, and nothing stored: a workspace's own secret, a bad list, an unknown name, a scoped caller.
  assert.equal((await put(admin, { name: "OWN_KEY", value: "x", workspace: "blog", workspaces: ["blog"] })).status, 400);
  assert.equal((await put(admin, { name: "BAD_KEY", value: "x", workspaces: "blog" })).status, 400);
  assert.equal((await put(admin, { name: "GHOST_KEY", value: "x", workspaces: ["nosuch"] })).status, 400);
  assert.equal((await put(scoped, { name: "SCOPED_KEY", value: "x", workspaces: ["sales"] })).status, 403);
  assert.equal(getSecret("acme", "GHOST_KEY"), null);
  assert.equal(getSecret("acme", "BAD_KEY"), null);
});

test("a conditional PATCH is refused 409 when the list changed since it was loaded", async () => {
  const stale = await patch(admin, { name: "CRM_KEY", workspaces: ["operations"], ifWorkspaces: null });
  assert.equal(stale.status, 409);
  assert.equal(getSecret("acme", "CRM_KEY", "blog")?.value, "crm", "nothing changed");
  assert.equal((await patch(admin, { name: "CRM_KEY", workspaces: ["blog", "operations"], ifWorkspaces: ["blog"] })).status, 200);
});

test("a delete is refused, and nothing deleted, while a secret limited to it cannot be read", async () => {
  const file = path.join(process.env.FOLDRUN_DATA!, "acme", "secrets.json");
  const vault = JSON.parse(fs.readFileSync(file, "utf8"));
  const good = vault.CRM_KEY;
  vault.CRM_KEY = { ...good, data: Buffer.from("garbage").toString("base64") };
  fs.writeFileSync(file, JSON.stringify(vault));
  const res = await wsRoute.DELETE(call(admin, "/api/workspaces/blog", "DELETE"), { params: Promise.resolve({ workspace: "blog" }) });
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /Nothing was deleted: CRM_KEY/);
  assert.ok(fs.existsSync(path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", "blog")));
  const back = JSON.parse(fs.readFileSync(file, "utf8"));
  back.CRM_KEY = good;
  fs.writeFileSync(file, JSON.stringify(back));
});

test("renaming onto a name that is taken is refused before the vault is touched", async () => {
  const res = await wsRoute.PATCH(call(admin, "/api/workspaces/operations", "PATCH", { name: "blog" }), { params: Promise.resolve({ workspace: "operations" }) });
  assert.equal(res.status, 409);
  assert.equal(getSecret("acme", "CRM_KEY", "operations")?.value, "crm");
});

test("null opens it to every workspace again", async () => {
  const res = await patch(admin, { name: "STRIPE_KEY", workspaces: null });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { workspaces: unknown }).workspaces, null);
  assert.equal((await listed()).find((s) => s.name === "STRIPE_KEY")?.workspaces, undefined);
  assert.equal(getSecret("acme", "STRIPE_KEY", "blog")?.value, "sk_live");
});
