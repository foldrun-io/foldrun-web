// Share links: who is handed the token, and how fast a revoke bites
// (30 Oct 2026).
//
// GET /api/workspaces/<ws>/shares returned every live token — the bearer
// capability behind /s/<token> — to every viewer, so a contractor who listed
// them kept working public links after their key was revoked. Now an admin
// and a link's own maker see the token and URL; everyone else sees the link
// exists, token masked, with an `id` an editor can revoke by. And /s/<token>
// was served "public, max-age=3600, immutable", so a CDN edge kept serving a
// revoked link for up to an hour; it is "private, no-store" now.
//
//   node --import ./tests/register.mjs --test tests/share-tokens.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-share-tokens-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_PUBLIC_URL = "https://share.example.test";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "outputs"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "outputs", "report.txt"), "the report");

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { shareId, readerSeesToken } = await import("@/platform/shares");
const shares = await import("../app/api/workspaces/[workspace]/shares/route.ts");
const serve = await import("../app/s/[token]/route.ts");

const keyOf = async (who: string, role: "admin" | "editor" | "viewer") => (await createApiKey(TENANT, who, `${who}@acme.test`, undefined, role)).key;
const admin = await keyOf("ana", "admin");
const editor = await keyOf("ed", "editor");
const other = await keyOf("eve", "editor");
const viewer = await keyOf("vic", "viewer");

const call = (method: string, key: string, query = "", body?: unknown) => {
  const h = (shares as unknown as Record<string, (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>>)[method];
  return h(
    new NextRequest(`http://localhost/api/workspaces/${WS}/shares${query}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": `${Math.random()}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ workspace: WS }) },
  );
};

type Row = { id: string; token: string; masked: boolean; url: string | null; path: string; createdBy: string | null };
const list = async (key: string) => ((await (await call("GET", key)).json()) as { shares: Row[] }).shares;

test("the maker and an admin see the token and URL; a viewer and another editor see it masked", async () => {
  const made = (await (await call("POST", editor, "", { path: "outputs/report.txt" })).json()) as { token: string; id: string; url: string };
  assert.ok(made.token && made.url.endsWith(made.token), "the maker gets the token on creation, as before");
  assert.equal(made.id, shareId(made.token));

  for (const [who, key] of [["maker", editor], ["admin", admin]] as const) {
    const row = (await list(key)).find((r) => r.id === made.id)!;
    assert.equal(row.token, made.token, `${who} sees the token`);
    assert.equal(row.masked, false);
    assert.equal(row.url, made.url);
  }
  for (const [who, key] of [["viewer", viewer], ["another editor", other]] as const) {
    const row = (await list(key)).find((r) => r.id === made.id)!;
    assert.ok(row, `${who} still sees that the link exists`);
    assert.notEqual(row.token, made.token, `${who} does not get the token`);
    assert.ok(row.token.length < 8, "the mask is a stub, not the token");
    assert.equal(row.masked, true);
    assert.equal(row.url, null);
    assert.equal(row.path, "outputs/report.txt");
    assert.equal(row.createdBy, "ed@acme.test");
  }
});

test("an editor revokes a colleague's link by id; a viewer cannot; an unknown id revokes nothing", async () => {
  const made = (await (await call("POST", editor, "", { path: "outputs/report.txt" })).json()) as { token: string; id: string };
  assert.equal((await call("DELETE", viewer, `?id=${made.id}`)).status, 403, "revoking stays an editor's act");
  const none = (await (await call("DELETE", other, "?id=sh_AAAAAAAAAAAAAAAAAAAAAA")).json()) as { revoked: boolean };
  assert.equal(none.revoked, false);
  const got = (await (await call("DELETE", other, `?id=${made.id}`)).json()) as { revoked: boolean };
  assert.equal(got.revoked, true);
  const res = await serve.GET(new NextRequest(`http://x/s/${made.token}`), { params: Promise.resolve({ token: made.token }) });
  assert.equal(res.status, 404, "the link is dead at once");
});

test("a served link is never kept by a shared cache, expiring or not", async () => {
  for (const ttlDays of [7, null]) {
    const made = (await (await call("POST", editor, "", { path: "outputs/report.txt", ttlDays })).json()) as { token: string };
    for (const method of ["GET", "HEAD"] as const) {
      const res = await serve[method](new NextRequest(`http://x/s/${made.token}`, { method }), { params: Promise.resolve({ token: made.token }) });
      assert.equal(res.status, 200);
      const cc = res.headers.get("cache-control") ?? "";
      assert.match(cc, /no-store/, `${method} ttl=${ttlDays}: ${cc}`);
      assert.match(cc, /private/);
      assert.doesNotMatch(cc, /public|immutable|max-age/);
    }
  }
});

test("readerSeesToken: admin always, the maker by email (any case), nobody by a missing name", () => {
  assert.equal(readerSeesToken({ createdBy: "a@x.test" }, { admin: true, name: null }), true);
  assert.equal(readerSeesToken({ createdBy: "A@X.test" }, { admin: false, name: "a@x.test" }), true);
  assert.equal(readerSeesToken({ createdBy: "a@x.test" }, { admin: false, name: "b@x.test" }), false);
  assert.equal(readerSeesToken({ createdBy: null }, { admin: false, name: null }), false);
  assert.equal(readerSeesToken({ createdBy: "storage/public" }, { admin: false, name: "e@x.test" }), false);
});
