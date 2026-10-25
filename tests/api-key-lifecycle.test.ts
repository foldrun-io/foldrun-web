// An API key's life: an optional end chosen at mint, a last-used time and
// coarse place written at most once a minute, a clear 401 once it has
// ended, rotation with a grace, and a week's notice to the owner.
//
//   node --import ./tests/register.mjs --test tests/api-key-lifecycle.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-key-life-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_RESEND_API_KEY;

const { NextRequest } = await import("next/server");
const { createApiKey, listApiKeys, parseKeyExpiry, parseGrace, coarseIp, resetKeyTouches } = await import("../server/auth.ts");
const { createAccountBySuperAdmin } = await import("../server/users.ts");
const keysRoute = await import("../app/api/keys/route.ts");
const rotateRoute = await import("../app/api/keys/[id]/rotate/route.ts");
const auditRoute = await import("../app/api/audit/route.ts");
const { warnExpiringKeys } = await import("../server/key-expiry.ts");
const { apiGate, resetApiGateCaches } = await import("../server/api-limits.ts");

await createAccountBySuperAdmin("owner@acme.test", "correct horse battery staple 9", "acme");
const { key: admin } = await createApiKey("acme", "ops", "owner@acme.test", undefined, "admin");
const keysFile = () => path.join(process.env.FOLDRUN_DATA!, "keys.json");
const editKey = (id: string, patch: Record<string, unknown>) => {
  const all = JSON.parse(fs.readFileSync(keysFile(), "utf8")) as Record<string, unknown>[];
  fs.writeFileSync(keysFile(), JSON.stringify(all.map((k) => (k.id === id ? { ...k, ...patch } : k))));
};
const call = (key: string, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://x${url}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const mint = async (body: Record<string, unknown>) => {
  const res = await keysRoute.POST(call(admin, "/api/keys", { method: "POST", body }));
  return { status: res.status, body: (await res.json()) as { key: string; id: string; expiresAt: string | null; error?: string } };
};
const DAY = 86_400_000;

test("parseKeyExpiry and parseGrace take days and durations, and refuse the rest", () => {
  const now = Date.UTC(2026, 9, 1);
  assert.equal(parseKeyExpiry("30d", now)?.getTime(), now + 30 * DAY);
  assert.equal(parseKeyExpiry(90, now)?.getTime(), now + 90 * DAY);
  assert.equal(parseKeyExpiry("never"), null);
  assert.equal(parseKeyExpiry(undefined), null);
  assert.throws(() => parseKeyExpiry("forever"), /number of days/);
  assert.throws(() => parseKeyExpiry("0d"), /number of days/);
  assert.equal(parseGrace("0"), 0);
  assert.equal(parseGrace("1h"), 3_600_000);
  assert.equal(parseGrace("24h"), 86_400_000);
  assert.throws(() => parseGrace("30d"), /up to 7d/);
  assert.equal(coarseIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.0/24");
  assert.equal(coarseIp(new Headers({ "x-forwarded-for": "2001:db8:abcd:12::1" })), "2001:db8:abcd::/48");
  assert.equal(coarseIp(new Headers()), null);
});

test("a key minted with an end carries it; a bad end is a 400, not a forever key", async () => {
  const made = await mint({ label: "ci", expires: "90d" });
  assert.equal(made.status, 200);
  const days = (Date.parse(made.body.expiresAt!) - Date.now()) / DAY;
  assert.ok(days > 89.9 && days <= 90, `~90 days, got ${days}`);
  const never = await mint({ label: "laptop" });
  assert.equal(never.body.expiresAt, null);
  const bad = await mint({ label: "typo", expires: "9O days" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error!, /number of days/);
  assert.ok(!(await listApiKeys("acme")).some((k) => k.label === "typo"));
});

test("an expired key is refused with a 401 that says it expired", async () => {
  const made = await mint({ label: "short", expires: "30d" });
  editKey(made.body.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const res = await auditRoute.GET(call(made.body.key, "/api/audit"));
  assert.equal(res.status, 401);
  assert.match(((await res.json()) as { error: string }).error, /API key expired on \d{4}-\d\d-\d\d/);
});

test("last used: written on authentication with a coarse address, at most once a minute", async () => {
  resetKeyTouches();
  const made = await mint({ label: "used" });
  await keysRoute.GET(call(made.body.key, "/api/keys", { headers: { "x-forwarded-for": "198.51.100.23" } })); // a viewer-or-editor key: refused, but authenticated
  const after = (await listApiKeys("acme")).find((k) => k.id === made.body.id)!;
  assert.ok(after.lastUsedAt, "last used is set");
  assert.equal(after.lastIp, "198.51.100.0/24", "never the full address");
  await keysRoute.GET(call(made.body.key, "/api/keys", { headers: { "x-forwarded-for": "192.0.2.9" } }));
  const again = (await listApiKeys("acme")).find((k) => k.id === made.body.id)!;
  assert.equal(again.lastUsedAt, after.lastUsedAt, "a second use within the minute writes nothing");
  assert.equal(again.lastIp, "198.51.100.0/24");
});

test("last used: the rate-limit gate's lookup ahead of the route still records the caller's address", async () => {
  resetKeyTouches();
  resetApiGateCaches();
  const made = await mint({ label: "gated" });
  // What proxy.ts does on every API call: the gate resolves the key first, then the route does.
  const req = () => call(made.body.key, "/api/keys", { headers: { "x-forwarded-for": "203.0.113.7" } });
  await apiGate(req());
  await keysRoute.GET(req());
  const after = (await listApiKeys("acme")).find((k) => k.id === made.body.id)!;
  assert.ok(after.lastUsedAt, "last used is set");
  assert.equal(after.lastIp, "203.0.113.0/24", "the gate's lookup carries the request's address");
});

test("rotate with a grace: a new key with the same label, role and scope; the old one ends when the grace does", async () => {
  const { key: oldKey, record } = await createApiKey("acme", "deploy-bot", "owner@acme.test", undefined, "viewer", ["leads"], { expiresAt: new Date(Date.now() + 30 * DAY) });
  const res = await rotateRoute.POST(call(admin, `/api/keys/${record.id}/rotate`, { method: "POST", body: { grace: "1h" } }), { params: Promise.resolve({ id: record.id }) });
  assert.equal(res.status, 200);
  const out = (await res.json()) as { key: string; id: string; role: string; workspaces: string[]; expiresAt: string; replaced: { id: string; endsAt: string } };
  assert.equal(out.role, "viewer");
  assert.deepEqual(out.workspaces, ["leads"]);
  assert.ok(Math.abs(Date.parse(out.expiresAt) - (Date.now() + 30 * DAY)) < 60_000, "the same lifetime, from today");
  assert.ok(Math.abs(Date.parse(out.replaced.endsAt) - (Date.now() + 3_600_000)) < 60_000);
  const all = await listApiKeys("acme");
  const fresh = all.find((k) => k.id === out.id)!;
  assert.equal(fresh.label, "deploy-bot");
  const old = all.find((k) => k.id === record.id)!;
  assert.equal(old.revokedAt, null, "still working during the grace");
  assert.ok(Math.abs(Date.parse(old.expiresAt!) - (Date.now() + 3_600_000)) < 60_000);
  // Both answer during the grace; once it is over the old one does not.
  assert.equal((await keysRoute.GET(call(out.key, "/api/keys"))).status, 403, "the new key authenticates (a viewer may not list keys)");
  editKey(record.id, { expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.equal((await keysRoute.GET(call(oldKey, "/api/keys"))).status, 401);
});

test("rotate with no grace revokes the old key at once; rotation is audited", async () => {
  const made = await mint({ label: "now" });
  const res = await rotateRoute.POST(call(admin, `/api/keys/${made.body.id}/rotate`, { method: "POST", body: { grace: "0" } }), { params: Promise.resolve({ id: made.body.id }) });
  assert.equal(res.status, 200);
  const old = (await listApiKeys("acme")).find((k) => k.id === made.body.id)!;
  assert.ok(old.revokedAt);
  const log = (await (await auditRoute.GET(call(admin, "/api/audit?action=apikey.rotated"))).json()) as { entries: { detail: Record<string, unknown> }[] };
  assert.ok(log.entries.some((e) => e.detail.replaces === made.body.id));
  // A key rotated with no grace is revoked, but it was rotated: the 409 names
  // what replaced it rather than a 404 saying there is no such key.
  const again = await rotateRoute.POST(call(admin, `/api/keys/${made.body.id}/rotate`, { method: "POST", body: {} }), { params: Promise.resolve({ id: made.body.id }) });
  assert.equal(again.status, 409);
  assert.match(((await again.json()) as { error: string }).error, /already rotated to .*rotate that one/);
  // A key revoked without a rotation cannot be rotated: not found.
  const gone = await mint({ label: "revoked" });
  assert.equal((await keysRoute.DELETE(call(admin, "/api/keys", { method: "DELETE", body: { id: gone.body.id } }))).status, 200);
  const revoked = await rotateRoute.POST(call(admin, `/api/keys/${gone.body.id}/rotate`, { method: "POST", body: {} }), { params: Promise.resolve({ id: gone.body.id }) });
  assert.equal(revoked.status, 404);
});

test("a rotated key whose grace has run out still names its replacement, not 'expired — mint a new one'", async () => {
  const { record } = await createApiKey("acme", "ci-lapsed", "owner@acme.test", undefined, "editor", null);
  const first = await rotateRoute.POST(call(admin, `/api/keys/${record.id}/rotate`, { method: "POST", body: { grace: "1h" } }), { params: Promise.resolve({ id: record.id }) });
  assert.equal(first.status, 200);
  const made = (await first.json()) as { prefix: string };
  editKey(record.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const again = await rotateRoute.POST(call(admin, `/api/keys/${record.id}/rotate`, { method: "POST", body: {} }), { params: Promise.resolve({ id: record.id }) });
  assert.equal(again.status, 409);
  assert.match(((await again.json()) as { error: string }).error, new RegExp(`already rotated to ${made.prefix}`));
});

test("a key already rotated cannot be rotated again: 409 naming the key that replaced it", async () => {
  const { record } = await createApiKey("acme", "ci-twice", "owner@acme.test", undefined, "editor", null);
  const first = await rotateRoute.POST(call(admin, `/api/keys/${record.id}/rotate`, { method: "POST", body: { grace: "24h" } }), { params: Promise.resolve({ id: record.id }) });
  assert.equal(first.status, 200);
  const made = (await first.json()) as { id: string; prefix: string };
  const old = (await listApiKeys("acme")).find((k) => k.id === record.id)!;
  assert.equal(old.replacedBy, made.id, "the old key records what replaced it");
  const before = (await listApiKeys("acme")).length;
  const again = await rotateRoute.POST(call(admin, `/api/keys/${record.id}/rotate`, { method: "POST", body: { grace: "24h" } }), { params: Promise.resolve({ id: record.id }) });
  assert.equal(again.status, 409);
  const body = (await again.json()) as { error: string };
  assert.match(body.error, new RegExp(`already rotated to ${made.prefix}`));
  assert.match(body.error, /rotate that one/);
  assert.equal((await listApiKeys("acme")).length, before, "no third key was minted");
  // The new key — the one whose secret may have been lost — rotates fine.
  const next = await rotateRoute.POST(call(admin, `/api/keys/${made.id}/rotate`, { method: "POST", body: { grace: "0" } }), { params: Promise.resolve({ id: made.id }) });
  assert.equal(next.status, 200);
});

test("revoke is audited too", async () => {
  const made = await mint({ label: "gone" });
  assert.equal((await keysRoute.DELETE(call(admin, "/api/keys", { method: "DELETE", body: { id: made.body.id } }))).status, 200);
  const log = (await (await auditRoute.GET(call(admin, "/api/audit?action=apikey.revoked"))).json()) as { entries: { subject: string }[] };
  assert.ok(log.entries.some((e) => e.subject === made.body.id));
});

test("the owner is mailed once, a week before a key ends", async () => {
  const { record } = await createApiKey("acme", "soon", "owner@acme.test", undefined, "editor", null, { expiresAt: new Date(Date.now() + 3 * DAY) });
  await createApiKey("acme", "later", "owner@acme.test", undefined, "editor", null, { expiresAt: new Date(Date.now() + 30 * DAY) });
  const sent: { to: string; subject: string }[] = [];
  const fake = async (_t: string, to: string, subject: string) => (sent.push({ to, subject }), true);
  assert.equal(await warnExpiringKeys(Date.now(), fake), 1);
  assert.equal(sent[0].to, "owner@acme.test");
  assert.match(sent[0].subject, /"soon" expires/);
  assert.equal(await warnExpiringKeys(Date.now(), fake), 0, "told once");
  assert.ok((await listApiKeys("acme")).find((k) => k.id === record.id)!.expiryWarnedAt);
  // A mail that did not go out is tried again next time.
  await createApiKey("acme", "retry", "owner@acme.test", undefined, "editor", null, { expiresAt: new Date(Date.now() + 2 * DAY) });
  assert.equal(await warnExpiringKeys(Date.now(), async () => false), 0);
  assert.equal(await warnExpiringKeys(Date.now(), fake), 1);
});

test("asking for a deploy key is refused, never answered with an account key", async () => {
  const before = (await listApiKeys("acme")).length;
  for (const body of [{ label: "ci", workspace: "leads", access: "write" }, { label: "ci", workspace: "leads" }, { label: "ci", access: "read" }]) {
    const r = await mint(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error ?? "", /deploy keys went with the platform's own git/);
  }
  assert.equal((await listApiKeys("acme")).length, before, "nothing was minted");
});
