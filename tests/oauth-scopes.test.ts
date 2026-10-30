// One saved OAuth app, many connections, any provider. A person in a browser
// gets the provider's URL with the consent bound to that browser (a cookie
// the callback must see again); an API key — the CLI — gets a hand-off page
// a signed-in person accepts first. Scopes ride along either way, and a
// reconnect asks again for the scopes a connection was made with.
//
//   node --import ./tests/register.mjs --test tests/oauth-scopes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-oauth-scopes-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { NextRequest } = await import("next/server");
const start = await import("../app/api/oauth/start/route.ts");
const reconnect = await import("../app/api/oauth/reconnect/route.ts");
const accept = await import("../app/api/oauth/handoff/[id]/route.ts");
const callback = await import("../app/api/oauth/callback/route.ts");
const { createApiKey } = await import("../server/auth.ts");
// Fixtures: several accounts, each its own owner — signup stays open for them.
process.env.FOLDRUN_OPEN_SIGNUP = "1";
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const { saveOAuthClient } = await import("../../foldrun-platform/src/oauth-clients.ts");
const { rememberConnection } = await import("../../foldrun-platform/src/oauth-connections.ts");
const { peekHandoff } = await import("../../foldrun-platform/src/oauth-connect.ts");
const { setOAuth2Secret } = await import("../../foldrun-core/src/secrets.ts");
const { scopesOf } = await import("../server/oauth-scopes.ts");

const owner = await createUser("o@acme.test", "correct horse battery staple 9", "acme");
const session = (await mintSession(owner)).value;
fs.mkdirSync(path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk/flows"), { recursive: true });
fs.writeFileSync(path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk/AGENTS.md"), "---\nname: desk\n---\n");
const APP = { authorize_url: "https://auth.example.test/authorize", token_url: "https://auth.example.test/token", client_id: "cid", client_secret: "shh", scopes: "default.scope" };
await saveOAuthClient("acme", "any-app", APP);
const { key } = await createApiKey("acme", "admin", "a@acme.test", undefined, "admin", null);

type Fn = (r: InstanceType<typeof NextRequest>, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
const asKey = (fn: Fn, url: string, body: object) =>
  fn(new NextRequest(`http://x${url}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
const asPerson = (fn: Fn, url: string, body: object, ctx?: { params: Promise<{ id: string }> }) =>
  fn(new NextRequest(`http://x${url}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${session}`, origin: "http://x", "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
const scopeOf = (url: string) => new URL(url).searchParams.get("scope");

test("a person: the app's default without scopes, this connection's own with them; the consent is bound to the browser", async () => {
  const plain = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "A_TOKEN", workspace: "desk" });
  assert.equal(plain.status, 200, await plain.clone().text());
  const p = (await plain.json()) as { url: string };
  assert.equal(scopeOf(p.url), "default.scope");
  assert.equal(new URL(p.url).searchParams.get("code_challenge_method"), "S256");
  const state = new URL(p.url).searchParams.get("state")!;
  const cookie = plain.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`foldrun_oauth_${state.slice(0, 16)}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/api\/oauth\/callback/);
  const own = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "B_TOKEN", workspace: "desk", scopes: "  read:things   write:things " });
  assert.equal(scopeOf(((await own.json()) as { url: string }).url), "read:things write:things");
});

test("the callback refuses a consent opened in another browser (no binding cookie)", async () => {
  const r = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "C_TOKEN", workspace: "desk" });
  const state = new URL(((await r.json()) as { url: string }).url).searchParams.get("state")!;
  const back = await callback.GET(new NextRequest(`http://x/api/oauth/callback?code=c&state=${state}`));
  const to = new URL(back.headers.get("location")!);
  assert.match(to.searchParams.get("connect_error") ?? "", /started in another browser/);
});

test("a provider error shows its words only to the browser that started the consent (30 Oct 2026)", async () => {
  // A crafted link: any text, no consent behind it.
  const spoof = await callback.GET(new NextRequest("http://x/api/oauth/callback?error=x&error_description=Your+account+is+suspended,+call+us"));
  const shown = new URL(spoof.headers.get("location")!).searchParams.get("connect_error") ?? "";
  assert.doesNotMatch(shown, /suspended/);
  assert.match(shown, /did not complete the connection/);
  // The real browser, refused at the provider, hears the provider.
  const r = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "D_TOKEN", workspace: "desk" });
  const state = new URL(((await r.json()) as { url: string }).url).searchParams.get("state")!;
  const binding = /foldrun_oauth_[^=]+=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")![1];
  const denied = await callback.GET(new NextRequest(`http://x/api/oauth/callback?error=access_denied&error_description=The+user+said+no&state=${state}`, {
    headers: { cookie: `foldrun_oauth_${state.slice(0, 16)}=${binding}` },
  }));
  assert.equal(new URL(denied.headers.get("location")!).searchParams.get("connect_error"), "The user said no");
});

test("a key gets a hand-off page; a signed-in person accepts it into a bound consent with the asked scopes", async () => {
  const r = await asKey(start.POST, "/api/oauth/start", { client: "any-app", secret: "CLI_TOKEN", workspace: "desk", scopes: "read:cli" });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { url: string; handoff?: boolean };
  assert.equal(body.handoff, true);
  const id = new URL(body.url).pathname.split("/").pop()!;
  assert.match(new URL(body.url).pathname, /^\/dashboard\/connect\/[a-f0-9]{48}$/);
  assert.equal((await peekHandoff(id))?.scopes, "read:cli");
  // A key cannot accept it.
  const byKey = await accept.POST(new NextRequest(`http://x/api/oauth/handoff/${id}`, { method: "POST", headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id }) });
  assert.equal(byKey.status, 401);
  const ok = await asPerson(accept.POST as Fn, `/api/oauth/handoff/${id}`, {}, { params: Promise.resolve({ id }) });
  assert.equal(ok.status, 200, await ok.clone().text());
  const url = ((await ok.json()) as { url: string }).url;
  assert.equal(scopeOf(url), "read:cli");
  assert.match(ok.headers.get("set-cookie") ?? "", /foldrun_oauth_/);
  // A lost answer can be retried: the hand-off stays until a consent from it completes.
  const again = await asPerson(accept.POST as Fn, `/api/oauth/handoff/${id}`, {}, { params: Promise.resolve({ id }) });
  assert.equal(again.status, 200, "a retried Accept gets a fresh bound consent");
});

test("start refuses scopes of the wrong shape", async () => {
  for (const scopes of [42, "", "a\u0000b", "x".repeat(2001)]) {
    const r = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "B_TOKEN", scopes });
    assert.equal(r.status, 400, String(scopes).slice(0, 20));
  }
  assert.equal(scopesOf(undefined), null);
});

test("reconnect asks for the scopes the connection was made with, not the app's default", async () => {
  setOAuth2Secret("acme", "B_TOKEN", { token_url: APP.token_url, client_id: "cid", client_secret: "shh", refresh_token: "rt" }, "desk");
  await rememberConnection("acme", "B_TOKEN", "desk", { ...APP, scopes: "read:things" });
  const r = await asPerson(reconnect.POST, "/api/oauth/reconnect", { secret: "B_TOKEN", workspace: "desk" });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(scopeOf(((await r.json()) as { url: string }).url), "read:things");
});

test("an Idempotency-Key retry of a browser-bound start gets its own consent and cookie, not a cookieless replay", async () => {
  const send = () => start.POST(new NextRequest("http://x/api/oauth/start", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${session}`, origin: "http://x", "content-type": "application/json", "idempotency-key": "retry-me" },
    body: JSON.stringify({ client: "any-app", secret: "RETRY_TOKEN", workspace: "desk" }),
  }));
  const first = await send();
  const second = await send();
  for (const r of [first, second]) {
    assert.equal(r.status, 200);
    assert.notEqual(r.headers.get("idempotent-replayed"), "true");
    assert.match(r.headers.get("set-cookie") ?? "", /foldrun_oauth_/);
    assert.equal(r.headers.get("x-foldrun-no-replay"), null, "the marker never leaves");
  }
});

test("a hand-off someone may not accept is refused without being used up", async () => {
  const other = await createUser("x@other.test", "correct horse battery staple 9", "other");
  const otherSession = (await mintSession(other)).value;
  const r = await asKey(start.POST, "/api/oauth/start", { client: "any-app", secret: "KEEP_TOKEN", workspace: "desk" });
  const id = new URL(((await r.json()) as { url: string }).url).pathname.split("/").pop()!;
  const wrong = await accept.POST(new NextRequest(`http://x/api/oauth/handoff/${id}`, { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${otherSession}`, origin: "http://x" } }), { params: Promise.resolve({ id }) });
  assert.equal(wrong.status, 404);
  assert.equal((await peekHandoff(id))?.name, "KEEP_TOKEN", "still there for the right person");
  const ok = await asPerson(accept.POST as Fn, `/api/oauth/handoff/${id}`, {}, { params: Promise.resolve({ id }) });
  assert.equal(ok.status, 200, await ok.clone().text());
});

test("a callback pinned to another host than the dashboard's refuses to start, naming where to go", async () => {
  process.env.FOLDRUN_OAUTH_CALLBACK_URL = "https://public.example.test/api/oauth/callback";
  try {
    const r = await asPerson(start.POST, "/api/oauth/start", { client: "any-app", secret: "HOST_TOKEN", workspace: "desk" });
    assert.equal(r.status, 409);
    assert.match(((await r.json()) as { error: string }).error, /open the dashboard at https:\/\/public\.example\.test/);
  } finally {
    delete process.env.FOLDRUN_OAUTH_CALLBACK_URL;
  }
});
