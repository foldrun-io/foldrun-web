// MCP over OAuth (1 Nov 2026): claude.ai and other AI apps sign in to
// /api/mcp with OAuth 2.1 instead of a pasted key (server/mcp-oauth.ts).
// End to end through the routes: discovery, registration, the person's
// approval, PKCE, the code exchange, the token at /api/mcp and refused
// everywhere else, refresh rotation and reuse, revoking, read-only, a chosen
// subset of workspaces, and a person demoted after approving.
//
//   node --import ./tests/register.mjs --test tests/mcp-oauth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-oauth-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_PUBLIC_URL = "https://app.example.test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-mcp-oauth";

const ORIGIN = "https://app.example.test";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const PW = "Correct-Horse-Battery-77";

const { NextRequest } = await import("next/server");
const { createUser, mintSession, findUserById, setMemberRole, SESSION_COOKIE } = await import("../server/users.ts");
type Req = InstanceType<typeof NextRequest>;
type Handler = (req: Req, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const prm = (await import("../app/.well-known/oauth-protected-resource/route.ts")) as { GET: Handler };
const prmPath = (await import("../app/.well-known/oauth-protected-resource/api/mcp/route.ts")) as { GET: Handler };
const asm = (await import("../app/.well-known/oauth-authorization-server/route.ts")) as { GET: Handler };
const register = (await import("../app/api/mcp/oauth/register/route.ts")) as { POST: Handler };
const authorize = (await import("../app/api/mcp/oauth/authorize/route.ts")) as { GET: Handler; POST: Handler };
const token = (await import("../app/api/mcp/oauth/token/route.ts")) as { POST: Handler };
const revoke = (await import("../app/api/mcp/oauth/revoke/route.ts")) as { POST: Handler };
const machineClients = (await import("../app/api/mcp/clients/route.ts")) as { POST: Handler };
const mcp = (await import("../app/api/mcp/route.ts")) as { POST: Handler };
const connections = (await import("../app/api/mcp/connections/route.ts")) as { GET: Handler };
const connection = (await import("../app/api/mcp/connections/[id]/route.ts")) as { DELETE: (req: Req, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
const workspacesRoute = (await import("../app/api/workspaces/route.ts")) as { GET: Handler };

function workspace(tenant: string, name: string) {
  const ws = path.join(DATA, tenant, "workspaces", name);
  fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
  fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
  fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${name}\n---\n`);
  fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
  fs.writeFileSync(path.join(ws, "flows/weekly.md"), "---\nname: weekly\ntrigger: manual\n---\n\n1. [[writer]] — write the weekly note\n");
}

const owner = await createUser("ana@acme.test", PW, "acme");
const member = await createUser("vic@acme.test", PW, "acme", { joining: true, role: "editor" });
workspace("acme", "desk");
workspace("acme", "other");
const cookieFor = async (id: string) => `${SESSION_COOKIE}=${(await mintSession((await findUserById(id))!)).value}`;
const ownerCookie = await cookieFor(owner.id);
const memberCookie = await cookieFor(member.id);

const get = (h: Handler, url: string, headers: Record<string, string> = {}) => h(new NextRequest(url, { headers }));
const postJson = (h: Handler, url: string, body: unknown, headers: Record<string, string> = {}) =>
  h(new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: JSON.stringify(body) }));
const postForm = (body: Record<string, string>, headers: Record<string, string> = {}) =>
  token.POST(new NextRequest(`${ORIGIN}/api/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body).toString() }));

function pkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

async function newClient(extra: Record<string, unknown> = {}) {
  const res = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], ...extra });
  assert.equal(res.status, 201);
  return (await res.json()) as { client_id: string; client_secret?: string };
}

function requestQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s-123", scope: "mcp:read mcp:write", resource: `${ORIGIN}/api/mcp`, ...extra }).toString();
}

/** The whole dance: register, approve as `cookie`, exchange — the tokens. */
async function connect(opts: { cookie?: string; access?: "read" | "write"; workspaces?: string[] | null; client?: { client_id: string; client_secret?: string } } = {}) {
  const client = opts.client ?? (await newClient());
  const { verifier, challenge } = pkce();
  const request = requestQuery(client.client_id, challenge);
  const ok = await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request, decision: "approve", access: opts.access ?? "write", workspaces: opts.workspaces ?? null }, { cookie: opts.cookie ?? ownerCookie });
  const { redirect } = (await ok.json()) as { redirect: string };
  const code = new URL(redirect).searchParams.get("code")!;
  const res = await postForm({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}), code_verifier: verifier, resource: `${ORIGIN}/api/mcp` });
  assert.equal(res.status, 200, await res.clone().text());
  return { client, ...((await res.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number }) };
}

let rpcId = 1;
async function call(tokenValue: string, method: string, params?: unknown) {
  const res = await mcp.POST(new NextRequest(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenValue}` }, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, ...(params ? { params } : {}) }) }));
  return { status: res.status, headers: res.headers, body: (await res.json()) as { result?: any; error?: { code: number; message: string } } }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const toolText = async (t: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await call(t, "tools/call", { name, arguments: args });
  return r.body.error ? { isError: true, text: r.body.error.message } : { isError: r.body.result.isError as boolean, text: r.body.result.content[0].text as string };
};

test("discovery: the resource names its server, and the server says PKCE S256", async () => {
  for (const h of [prm, prmPath]) {
    const doc = (await (await get(h.GET, `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`)).json()) as Record<string, unknown>;
    assert.equal(doc.resource, `${ORIGIN}/api/mcp`);
    assert.deepEqual(doc.authorization_servers, [ORIGIN]);
  }
  const res = await get(asm.GET, `${ORIGIN}/.well-known/oauth-authorization-server`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const as = (await res.json()) as Record<string, unknown>;
  assert.equal(as.issuer, ORIGIN);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/mcp/authorize`);
  assert.equal(as.token_endpoint, `${ORIGIN}/api/mcp/oauth/token`);
  assert.equal(as.registration_endpoint, `${ORIGIN}/api/mcp/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.equal(as.client_id_metadata_document_supported, true);

  const unauth = await mcp.POST(new NextRequest(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }));
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
});

test("registration: https or loopback redirect URIs only; a secret only when asked for", async () => {
  const bad = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { client_name: "x", redirect_uris: ["http://evil.example/cb"] });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, "invalid_redirect_uri");
  const frag = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { redirect_uris: ["https://a.example/cb#x"] });
  assert.equal(frag.status, 400);
  const loop = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { redirect_uris: ["http://127.0.0.1:33418/callback"], token_endpoint_auth_method: "none" });
  assert.equal(loop.status, 201);
  const pub = await newClient();
  assert.equal(pub.client_secret, undefined);
  const conf = await newClient({ token_endpoint_auth_method: "client_secret_basic" });
  assert.match(conf.client_secret ?? "", /^fmcp_cs_/);
});

test("the approval page's request: a person only, the app and where the answer goes, and what is never redirected", async () => {
  const client = await newClient();
  const { challenge } = pkce();
  const request = requestQuery(client.client_id, challenge);
  assert.equal((await get(authorize.GET, `${ORIGIN}/api/mcp/oauth/authorize?request=${encodeURIComponent(request)}`)).status, 401, "signed out");
  const ask = (await (await get(authorize.GET, `${ORIGIN}/api/mcp/oauth/authorize?request=${encodeURIComponent(request)}`, { cookie: ownerCookie })).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(ask.client.name, "Claude");
  assert.equal(ask.redirectHost, "claude.ai");
  assert.equal(ask.account, "acme");
  assert.deepEqual(ask.workspaces.sort(), ["desk", "other"]);

  const elsewhere = requestQuery(client.client_id, challenge, { redirect_uri: "https://evil.example/cb" });
  const refused = await get(authorize.GET, `${ORIGIN}/api/mcp/oauth/authorize?request=${encodeURIComponent(elsewhere)}`, { cookie: ownerCookie });
  assert.equal(refused.status, 400, "a redirect URI the app did not register is shown, never followed");
  assert.equal(((await refused.json()) as { redirect?: string }).redirect, undefined);

  const noPkce = new URLSearchParams(request);
  noPkce.delete("code_challenge");
  const back = (await (await get(authorize.GET, `${ORIGIN}/api/mcp/oauth/authorize?request=${encodeURIComponent(noPkce.toString())}`, { cookie: ownerCookie })).json()) as { redirect: string };
  const u = new URL(back.redirect);
  assert.equal(u.origin + u.pathname, CALLBACK);
  assert.equal(u.searchParams.get("error"), "invalid_request");
  assert.equal(u.searchParams.get("state"), "s-123");

  const other = requestQuery(client.client_id, challenge, { resource: "https://other.example/mcp" });
  const target = (await (await get(authorize.GET, `${ORIGIN}/api/mcp/oauth/authorize?request=${encodeURIComponent(other)}`, { cookie: ownerCookie })).json()) as { redirect: string };
  assert.equal(new URL(target.redirect).searchParams.get("error"), "invalid_target");

  const denied = (await (await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request, decision: "deny" }, { cookie: ownerCookie })).json()) as { redirect: string };
  assert.equal(new URL(denied.redirect).searchParams.get("error"), "access_denied");
  assert.equal(new URL(denied.redirect).searchParams.get("iss"), ORIGIN);
});

test("the code: PKCE, once, for its own app and redirect", async () => {
  const client = await newClient();
  const { verifier, challenge } = pkce();
  const request = requestQuery(client.client_id, challenge);
  const approved = (await (await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request, decision: "approve" }, { cookie: ownerCookie })).json()) as { redirect: string };
  const back = new URL(approved.redirect);
  assert.equal(back.searchParams.get("state"), "s-123");
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  const code = back.searchParams.get("code")!;

  const wrongVerifier = await postForm({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: pkce().verifier });
  assert.equal(wrongVerifier.status, 400);
  assert.equal(((await wrongVerifier.json()) as { error: string }).error, "invalid_grant");
  // The failed try spent it: a code is good once, right or wrong.
  const late = await postForm({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier });
  assert.equal(late.status, 400);

  const { verifier: v2, challenge: c2 } = pkce();
  const again = (await (await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request: requestQuery(client.client_id, c2), decision: "approve" }, { cookie: ownerCookie })).json()) as { redirect: string };
  const code2 = new URL(again.redirect).searchParams.get("code")!;
  const otherApp = await newClient();
  const stolen = await postForm({ grant_type: "authorization_code", code: code2, redirect_uri: CALLBACK, client_id: otherApp.client_id, code_verifier: v2 });
  assert.equal(stolen.status, 400, "another app cannot redeem it");
});

test("a confidential app proves itself with its secret", async () => {
  const client = await newClient({ token_endpoint_auth_method: "client_secret_basic" });
  const { verifier, challenge } = pkce();
  const approved = (await (await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request: requestQuery(client.client_id, challenge), decision: "approve" }, { cookie: ownerCookie })).json()) as { redirect: string };
  const code = new URL(approved.redirect).searchParams.get("code")!;
  const form = { grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier };
  const noSecret = await postForm({ ...form, client_id: client.client_id });
  assert.equal(noSecret.status, 401);
  // The failed try did not spend the code: client authentication comes first.
  const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64");
  const ok = await postForm(form, { authorization: `Basic ${basic}` });
  assert.equal(ok.status, 200, await ok.clone().text());
});

test("the access token opens /api/mcp and its tools — and no other route", async () => {
  const t = await connect();
  assert.equal(t.scope, "mcp:read mcp:write");
  assert.ok(t.expires_in > 0);
  const list = await call(t.access_token, "tools/list");
  assert.equal(list.status, 200);
  assert.ok(list.body.result.tools.some((x: { name: string }) => x.name === "run_flow"));
  const ws = await toolText(t.access_token, "list_workspaces");
  assert.equal(ws.isError, false);
  assert.deepEqual(JSON.parse(ws.text).workspaces.map((w: { name: string }) => w.name).sort(), ["desk", "other"]);
  const me = JSON.parse((await toolText(t.access_token, "whoami")).text);
  assert.equal(me.account, "acme");
  const inbox = await toolText(t.access_token, "inbox");
  assert.equal(inbox.isError, false, "the inbox of the person who approved it");
  const run = await toolText(t.access_token, "run_flow", { workspace: "desk", flow: "weekly", test: true });
  assert.equal(run.isError, false, run.text);

  const direct = await workspacesRoute.GET(new NextRequest(`${ORIGIN}/api/workspaces`, { headers: { authorization: `Bearer ${t.access_token}` } }));
  assert.equal(direct.status, 403, "not a key: it opens /api/mcp only");
  const spoof = await workspacesRoute.GET(new NextRequest(`${ORIGIN}/api/workspaces`, { headers: { authorization: `Bearer ${t.access_token}`, "x-foldrun-mcp-inner": "guess" } }));
  assert.equal(spoof.status, 403, "the inner mark cannot be guessed from outside");

  const bogus = await call("fmcp_at_not-a-real-token", "ping");
  assert.equal(bogus.status, 401);
  assert.match(bogus.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
});

test("refresh rotates; a refresh token used twice ends the connection", async () => {
  const t = await connect();
  const r1 = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client.client_id });
  assert.equal(r1.status, 200);
  const n = (await r1.json()) as { access_token: string; refresh_token: string };
  assert.notEqual(n.refresh_token, t.refresh_token);
  assert.equal((await call(n.access_token, "ping")).status, 200);

  // A rotated refresh token sent as a code must not erase what catches its reuse.
  const asCode = await postForm({ grant_type: "authorization_code", code: t.refresh_token, redirect_uri: CALLBACK, client_id: t.client.client_id, code_verifier: pkce().verifier });
  assert.equal(asCode.status, 400);
  const replay = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client.client_id });
  assert.equal(replay.status, 400);
  assert.match(((await replay.json()) as { error_description: string }).error_description, /already used/);
  assert.equal((await call(n.access_token, "ping")).status, 401, "every token of the connection ends with it");
  const after = await postForm({ grant_type: "refresh_token", refresh_token: n.refresh_token, client_id: t.client.client_id });
  assert.equal(after.status, 400);
});

test("a refresh may narrow the scope, never widen it", async () => {
  const t = await connect();
  const narrowed = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client.client_id, scope: "mcp:read" });
  assert.equal(narrowed.status, 200);
  const n = (await narrowed.json()) as { access_token: string; refresh_token: string; scope: string };
  assert.equal(n.scope, "mcp:read");
  const names = (await call(n.access_token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
  assert.ok(!names.includes("run_flow"), "the narrowed token offers the read tools only");
  // The connection itself is unchanged: its next refresh, unnarrowed, acts again.
  const back = (await (await postForm({ grant_type: "refresh_token", refresh_token: n.refresh_token, client_id: t.client.client_id })).json()) as { scope: string; refresh_token: string };
  assert.equal(back.scope, "mcp:read mcp:write");

  const ro = await connect({ access: "read" });
  const wider = await postForm({ grant_type: "refresh_token", refresh_token: ro.refresh_token, client_id: ro.client.client_id, scope: "mcp:read mcp:write" });
  assert.equal(wider.status, 400);
  assert.equal(((await wider.json()) as { error: string }).error, "invalid_scope");
});

test("read only: the tools that act are not offered, and an inner write is refused", async () => {
  const t = await connect({ access: "read" });
  assert.equal(t.scope, "mcp:read");
  const names = (await call(t.access_token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
  assert.ok(!names.includes("run_flow") && names.includes("get_run"));
  const refused = await toolText(t.access_token, "run_flow", { workspace: "desk", flow: "weekly" });
  assert.equal(refused.isError, true);
  assert.match(refused.text, /read-only/);
  // And underneath the tool list: an in-process write with this token is refused by the funnel.
  const { MCP_INNER_HEADER, mcpInnerSecret } = await import("../server/mcp-inner.ts");
  const flowRun = (await import("../app/api/workspaces/[workspace]/flows/[flow]/run/route.ts")) as { POST: Handler };
  const inner = await flowRun.POST(
    new NextRequest(`${ORIGIN}/api/workspaces/desk/flows/weekly/run`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t.access_token}`, [MCP_INNER_HEADER]: mcpInnerSecret() }, body: "{}" }),
    { params: Promise.resolve({ workspace: "desk", flow: "weekly" }) },
  );
  assert.equal(inner.status, 403);
  assert.match(((await inner.json()) as { error: string }).error, /read-only/);
});

test("a chosen subset of workspaces is all it sees", async () => {
  const t = await connect({ workspaces: ["desk"] });
  const ws = JSON.parse((await toolText(t.access_token, "list_workspaces")).text);
  assert.deepEqual(ws.workspaces.map((w: { name: string }) => w.name), ["desk"]);
  const other = await toolText(t.access_token, "read_file", { workspace: "other", path: "flows/weekly.md" });
  assert.equal(other.isError, true);
  assert.match(other.text, /^HTTP 403/);
  const unknown = await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request: requestQuery((await newClient()).client_id, pkce().challenge), decision: "approve", workspaces: ["nope"] }, { cookie: ownerCookie });
  assert.equal(unknown.status, 403);
});

test("a person demoted after approving takes the app down with them", async () => {
  const t = await connect({ cookie: memberCookie });
  assert.equal((await toolText(t.access_token, "run_flow", { workspace: "desk", flow: "weekly", test: true })).isError, false);
  await setMemberRole("acme", member.id, "viewer", owner.id);
  const now = await toolText(t.access_token, "run_flow", { workspace: "desk", flow: "weekly", test: true });
  assert.equal(now.isError, true);
  assert.match(now.text, /^HTTP 403: your role \(viewer\)/);
  await setMemberRole("acme", member.id, "editor", owner.id);
});

test("connections: listed, and revoked by their person or an admin — at once", async () => {
  const mine = await connect({ cookie: memberCookie });
  const listedByMember = (await (await get(connections.GET, `${ORIGIN}/api/mcp/connections`, { cookie: memberCookie })).json()) as { connections: { id: string; person: string }[]; everyone: boolean };
  assert.equal(listedByMember.everyone, false);
  assert.ok(listedByMember.connections.every((c) => c.person === "vic@acme.test"), "a member sees their own");
  const listedByOwner = (await (await get(connections.GET, `${ORIGIN}/api/mcp/connections`, { cookie: ownerCookie })).json()) as { connections: { id: string; person: string; client: string }[]; everyone: boolean };
  assert.equal(listedByOwner.everyone, true);
  assert.ok(listedByOwner.connections.some((c) => c.person === "ana@acme.test") && listedByOwner.connections.some((c) => c.person === "vic@acme.test"));

  const ownersOne = listedByOwner.connections.find((c) => c.person === "ana@acme.test")!;
  const notYours = await connection.DELETE(new NextRequest(`${ORIGIN}/api/mcp/connections/${ownersOne.id}`, { method: "DELETE", headers: { cookie: memberCookie, origin: ORIGIN } }), { params: Promise.resolve({ id: ownersOne.id }) });
  assert.equal(notYours.status, 403);

  const id = listedByMember.connections[0].id;
  assert.equal((await call(mine.access_token, "ping")).status, 200);
  const gone = await connection.DELETE(new NextRequest(`${ORIGIN}/api/mcp/connections/${id}`, { method: "DELETE", headers: { cookie: ownerCookie, origin: ORIGIN } }), { params: Promise.resolve({ id }) });
  assert.equal(gone.status, 200);
  // Every connection of the member's went; the newest is enough to check.
  const any = (await (await get(connections.GET, `${ORIGIN}/api/mcp/connections`, { cookie: memberCookie })).json()) as { connections: { id: string }[] };
  assert.ok(!any.connections.some((c) => c.id === id));
  const again = await connection.DELETE(new NextRequest(`${ORIGIN}/api/mcp/connections/${id}`, { method: "DELETE", headers: { cookie: ownerCookie, origin: ORIGIN } }), { params: Promise.resolve({ id }) });
  assert.equal(again.status, 404);
});

const postRevoke = (body: Record<string, string>, headers: Record<string, string> = {}) =>
  revoke.POST(new NextRequest(`${ORIGIN}/api/mcp/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body).toString() }));

test("revocation (RFC 7009): advertised; an app revoking its refresh token ends the connection and every token", async () => {
  const as = (await (await get(asm.GET, `${ORIGIN}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
  assert.equal(as.revocation_endpoint, `${ORIGIN}/api/mcp/oauth/revoke`);
  const c = await connect();
  assert.equal((await call(c.access_token, "tools/list")).status, 200);
  const res = await postRevoke({ token: c.refresh_token, token_type_hint: "refresh_token", client_id: c.client.client_id });
  assert.equal(res.status, 200);
  assert.equal((await call(c.access_token, "tools/list")).status, 401, "the access token went with the grant");
  const again = await postForm({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id });
  assert.equal(again.status, 400);
  // Already gone, unknown, or not a token at all: 200, nothing to say (§2.2).
  assert.equal((await postRevoke({ token: c.refresh_token, client_id: c.client.client_id })).status, 200);
  assert.equal((await postRevoke({ token: "fmcp_at_nonsense", client_id: c.client.client_id })).status, 200);
});

test("revocation: an access token ends the connection too; another app's token is refused; the client must authenticate", async () => {
  const c = await connect();
  const other = await newClient();
  const foreign = await postRevoke({ token: c.access_token, client_id: other.client_id });
  assert.equal(foreign.status, 400);
  assert.equal(((await foreign.json()) as { error: string }).error, "unauthorized_client");
  assert.equal((await call(c.access_token, "tools/list")).status, 200, "another app cannot end it");

  const confidential = await newClient({ token_endpoint_auth_method: "client_secret_basic" });
  const cc = await connect({ client: confidential });
  const noSecret = await postRevoke({ token: cc.access_token, client_id: confidential.client_id });
  assert.equal(noSecret.status, 401, "a confidential app proves itself, as at the token endpoint");
  const basic = `Basic ${Buffer.from(`${confidential.client_id}:${confidential.client_secret}`).toString("base64")}`;
  assert.equal((await postRevoke({ token: cc.access_token, token_type_hint: "access_token" }, { authorization: basic })).status, 200);
  assert.equal((await call(cc.access_token, "tools/list")).status, 401);
  assert.equal((await postForm({ grant_type: "refresh_token", refresh_token: cc.refresh_token }, { authorization: basic })).status, 400, "the refresh token went with it");

  assert.equal((await postRevoke({ client_id: c.client.client_id })).status, 400, "token is required");
  // An unknown hint is ignored (§2.1): the token is still revoked.
  const unknownHint = await postRevoke({ token: c.access_token, token_type_hint: "id_token", client_id: c.client.client_id });
  assert.equal(unknownHint.status, 200);
  assert.equal(unknownHint.headers.get("access-control-allow-origin"), "*", "a browser app reads the answer");
  assert.equal((await call(c.access_token, "tools/list")).status, 401);
});

test("private_key_jwt (RFC 7523): an app with a JWKS signs in with assertions; a replayed jti, a wrong aud, a secret beside it and a private key in jwks are refused", async () => {
  const { generateClientKey, signClientAssertion, ASSERTION_TYPE } = await import("../../foldrun-core/src/oauth-assertion.ts");
  const { privateKey, publicJwk } = generateClientKey();
  const leaked = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { client_name: "x", redirect_uris: [CALLBACK], token_endpoint_auth_method: "private_key_jwt", jwks: { keys: [{ ...publicJwk, d: "secret" }] } });
  assert.equal(leaked.status, 400, "a private key in jwks is refused at registration");
  const reg = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { client_name: "Signed app", redirect_uris: [CALLBACK], token_endpoint_auth_method: "private_key_jwt", grant_types: ["authorization_code", "refresh_token"], jwks: { keys: [publicJwk] } });
  assert.equal(reg.status, 201);
  const app = (await reg.json()) as { client_id: string; client_secret?: string };
  assert.equal(app.client_secret, undefined, "no secret is issued to a key-authenticated app");
  const as = (await (await get(asm.GET, `${ORIGIN}/.well-known/oauth-authorization-server`)).json()) as { token_endpoint_auth_methods_supported: string[] };
  assert.ok(as.token_endpoint_auth_methods_supported.includes("private_key_jwt"));

  const sign = (aud = `${ORIGIN}/api/mcp/oauth/token`) => signClientAssertion({ client_id: app.client_id, client_assertion_key: privateKey }, aud);
  const { verifier, challenge } = pkce();
  const ok = await postJson(authorize.POST, `${ORIGIN}/api/mcp/oauth/authorize`, { request: requestQuery(app.client_id, challenge), decision: "approve", access: "read", workspaces: null }, { cookie: ownerCookie });
  const code = new URL(((await ok.json()) as { redirect: string }).redirect).searchParams.get("code")!;
  const first = sign();
  const res = await postForm({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: app.client_id, client_assertion_type: ASSERTION_TYPE, client_assertion: first });
  assert.equal(res.status, 200, await res.clone().text());
  const t = (await res.json()) as { access_token: string; refresh_token: string };
  assert.equal((await call(t.access_token, "tools/list")).status, 200);

  const replay = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: first });
  assert.equal(replay.status, 401);
  assert.match(((await replay.json()) as { error_description: string }).error_description, /already used/);
  const wrongAud = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: sign("https://elsewhere.example/token") });
  assert.equal(wrongAud.status, 401);
  const both = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_secret: "x", client_assertion_type: ASSERTION_TYPE, client_assertion: sign() });
  assert.equal(both.status, 400, "one method per request");
  const noAssertion = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: app.client_id });
  assert.equal(noAssertion.status, 401, "a key-authenticated app cannot fall back to no authentication");
  // A fresh assertion refreshes; the issuer is an accepted aud too.
  const fresh = await postForm({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: sign(ORIGIN) });
  assert.equal(fresh.status, 200, await fresh.clone().text());
});

test("machine clients (client credentials, part G): an admin registers one; it gets access tokens and no refresh token, lists tools, is held to read-only and its role, and a disconnected one is invalid_client", async () => {
  const notAdmin = await postJson(machineClients.POST, `${ORIGIN}/api/mcp/clients`, { name: "nightly", role: "viewer" }, { cookie: memberCookie });
  assert.equal(notAdmin.status, 403, "an editor cannot register one");
  const reg = await postJson(machineClients.POST, `${ORIGIN}/api/mcp/clients`, { name: "Nightly report bot", role: "editor", workspaces: ["desk"], access: "read" }, { cookie: ownerCookie });
  assert.equal(reg.status, 201, await reg.clone().text());
  const m = (await reg.json()) as { client_id: string; client_secret: string; grant: string; token_endpoint: string };
  assert.equal(m.token_endpoint, `${ORIGIN}/api/mcp/oauth/token`);
  const basic = `Basic ${Buffer.from(`${m.client_id}:${m.client_secret}`).toString("base64")}`;
  const tok = await postForm({ grant_type: "client_credentials" }, { authorization: basic });
  assert.equal(tok.status, 200, await tok.clone().text());
  const t = (await tok.json()) as { access_token: string; refresh_token?: string; scope: string };
  assert.equal(t.refresh_token, undefined, "no refresh token for client credentials");
  assert.equal(t.scope, "mcp:read");
  const names = (await call(t.access_token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
  assert.ok(names.includes("get_run") && !names.includes("run_flow"), "read only: the acting tools are not offered");
  assert.equal((await toolText(t.access_token, "run_flow", { workspace: "desk", flow: "weekly" })).isError, true);
  const listed = (await (await get(connections.GET, `${ORIGIN}/api/mcp/connections`, { cookie: ownerCookie })).json()) as { connections: { id: string; machine: boolean; client: string }[] };
  assert.ok(listed.connections.some((c) => c.id === m.grant && c.machine && c.client === "Nightly report bot"), "listed with the connected apps");
  assert.equal((await postForm({ grant_type: "client_credentials", scope: "mcp:read mcp:write" }, { authorization: basic })).status, 400, "it cannot ask for more than it holds");
  assert.equal((await postForm({ grant_type: "client_credentials" }, { authorization: `Basic ${Buffer.from(`${m.client_id}:wrong`).toString("base64")}` })).status, 401);
  // An app a person signed in cannot use client credentials.
  const person = await connect();
  assert.equal((await postForm({ grant_type: "client_credentials", client_id: person.client.client_id })).status, 400);
  const off = await connection.DELETE(new NextRequest(`${ORIGIN}/api/mcp/connections/${m.grant}`, { method: "DELETE", headers: { cookie: ownerCookie, origin: ORIGIN } }), { params: Promise.resolve({ id: m.grant }) });
  assert.equal(off.status, 200);
  assert.equal((await call(t.access_token, "tools/list")).status, 401, "its token stops at once");
  const after = await postForm({ grant_type: "client_credentials" }, { authorization: basic });
  assert.equal(after.status, 401);
  assert.equal(((await after.json()) as { error: string }).error, "invalid_client");
});

test("a machine client can sign in with private_key_jwt and is capped by its admin's role at every use", async () => {
  const { generateClientKey, signClientAssertion, ASSERTION_TYPE } = await import("../../foldrun-core/src/oauth-assertion.ts");
  const { privateKey, publicJwk } = generateClientKey();
  const reg = await postJson(machineClients.POST, `${ORIGIN}/api/mcp/clients`, { name: "Signed bot", role: "owner", access: "write", token_auth: "private_key_jwt", jwks: { keys: [publicJwk] } }, { cookie: ownerCookie });
  assert.equal(reg.status, 201, await reg.clone().text());
  const m = (await reg.json()) as { client_id: string; client_secret?: string };
  assert.equal(m.client_secret, undefined);
  const tok = await postForm({ grant_type: "client_credentials", client_assertion_type: ASSERTION_TYPE, client_assertion: signClientAssertion({ client_id: m.client_id, client_assertion_key: privateKey }, `${ORIGIN}/api/mcp/oauth/token`) });
  assert.equal(tok.status, 200, await tok.clone().text());
  const t = (await tok.json()) as { access_token: string };
  assert.ok((await call(t.access_token, "tools/list")).body.result.tools.some((x: { name: string }) => x.name === "run_flow"), "read and act");
  const tooHigh = await postJson(machineClients.POST, `${ORIGIN}/api/mcp/clients`, { name: "x", role: "owner" }, { cookie: (await (async () => { await setMemberRole("acme", member.id, "admin", owner.id); return cookieFor(member.id); })()) });
  assert.equal(tooHigh.status, 403, "an admin cannot give a machine client more than they hold");
  await setMemberRole("acme", member.id, "editor", owner.id);
});

test("the open registration endpoint is limited per address", async () => {
  let last: Response | undefined;
  for (let i = 0; i < 40; i++) {
    last = await postJson(register.POST, `${ORIGIN}/api/mcp/oauth/register`, { client_name: `flood ${i}`, redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    if (last.status === 429) break;
  }
  assert.equal(last!.status, 429, "30 an hour from one address, then slow_down");
  assert.ok(Number(last!.headers.get("retry-after")) > 0);
  assert.equal(((await last!.json()) as { error: string }).error, "slow_down");
});

