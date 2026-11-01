// The official MCP TypeScript SDK signing in to /api/mcp with OAuth, end to
// end through the real route handlers — no server, so it runs with `npm
// test`. What claude.ai does, done by the SDK every MCP client builds on:
// the 401 with resource_metadata, protected-resource and authorization-server
// metadata, dynamic registration, PKCE, the person's approval (played here
// through the approval route with a session cookie), the code exchange, a
// tool call, the refresh, and revocation (RFC 7009). The proof behind the
// server rows of core src/oauth-capabilities.ts, kept from the check made by
// hand on 1 Nov 2026.
//
//   node --import ./tests/register.mjs --test tests/mcp-sdk-oauth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-mcp-sdk-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_PUBLIC_URL = "https://app.example.test";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-mcp-sdk";

const ORIGIN = "https://app.example.test";
const CALLBACK = "http://127.0.0.1:33418/callback";

const { NextRequest } = await import("next/server");
const { createUser, mintSession, findUserById, SESSION_COOKIE } = await import("../server/users.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
type Req = InstanceType<typeof NextRequest>;
type Handler = (req: Req) => Promise<Response> | Response;

const routes: Record<string, Record<string, Handler>> = {
  "/.well-known/oauth-protected-resource": await import("../app/.well-known/oauth-protected-resource/route.ts"),
  "/.well-known/oauth-protected-resource/api/mcp": await import("../app/.well-known/oauth-protected-resource/api/mcp/route.ts"),
  "/.well-known/oauth-authorization-server": await import("../app/.well-known/oauth-authorization-server/route.ts"),
  "/api/mcp/oauth/register": await import("../app/api/mcp/oauth/register/route.ts"),
  "/api/mcp/oauth/authorize": await import("../app/api/mcp/oauth/authorize/route.ts"),
  "/api/mcp/oauth/token": await import("../app/api/mcp/oauth/token/route.ts"),
  "/api/mcp/oauth/revoke": await import("../app/api/mcp/oauth/revoke/route.ts"),
  "/api/mcp": await import("../app/api/mcp/route.ts"),
} as unknown as Record<string, Record<string, Handler>>;

const seen: string[] = [];
/** The SDK's fetch, answered by the route handlers in this process. */
async function inProcess(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== ORIGIN) throw new Error(`the SDK reached outside the server: ${url}`);
  seen.push(`${req.method} ${url.pathname}`);
  const handler = routes[url.pathname]?.[req.method];
  if (!handler) return new Response("not found", { status: 404 });
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  return handler(new NextRequest(req.url, { method: req.method, headers: req.headers, ...(body !== undefined ? { body } : {}) }));
}

const owner = await createUser("ana@acme.test", "Correct-Horse-Battery-77", "acme");
const ws = path.join(DATA, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\ndescription: writes\n---\n\nWrite.\n");
const cookie = `${SESSION_COOKIE}=${(await mintSession((await findUserById(owner.id))!)).value}`;

/** The OAuthClientProvider an MCP client implements, kept in memory. */
class Provider {
  info: Record<string, unknown> | undefined;
  saved: { access_token: string; refresh_token?: string } | undefined;
  verifier = "";
  authorizeUrl: URL | undefined;
  get redirectUrl() { return CALLBACK; }
  get clientMetadata() {
    return { client_name: "MCP SDK conformance", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() { return "sdk-state-1"; }
  clientInformation() { return this.info as never; }
  saveClientInformation(i: Record<string, unknown>) { this.info = i; }
  tokens() { return this.saved as never; }
  saveTokens(t: { access_token: string; refresh_token?: string }) { this.saved = t; }
  redirectToAuthorization(u: URL) { this.authorizeUrl = u; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
}

/** The person: approve the request the SDK's authorize URL carries. */
async function approve(authorizeUrl: URL): Promise<string> {
  const request = authorizeUrl.searchParams.toString();
  const res = await routes["/api/mcp/oauth/authorize"].POST(new NextRequest(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify({ request, decision: "approve", access: "write", workspaces: null }),
  }));
  assert.equal(res.status, 200, await res.clone().text());
  const back = new URL(((await res.json()) as { redirect: string }).redirect);
  assert.equal(back.searchParams.get("state"), "sdk-state-1");
  assert.equal(back.searchParams.get("iss"), ORIGIN, "RFC 9207");
  return back.searchParams.get("code")!;
}

test("the MCP SDK: 401 → discovery → registration → PKCE → approval → tokens → tools → refresh → revoke", async () => {
  const provider = new Provider();
  const serverUrl = new URL(`${ORIGIN}/api/mcp`);
  const connectFresh = async () => {
    const transport = new StreamableHTTPClientTransport(serverUrl, { authProvider: provider as never, fetch: inProcess });
    const client = new Client({ name: "conformance", version: "1.0.0" });
    await client.connect(transport);
    return client;
  };

  // No token: the SDK is told to sign in, and asks for the person's approval.
  await assert.rejects(connectFresh(), /Unauthorized/i);
  assert.ok(provider.info?.client_id, "registered itself (RFC 7591)");
  assert.ok(provider.authorizeUrl, "built an authorize URL");
  assert.equal(provider.authorizeUrl!.searchParams.get("code_challenge_method"), "S256");
  assert.equal(provider.authorizeUrl!.searchParams.get("resource"), `${ORIGIN}/api/mcp`, "RFC 8707");
  for (const step of ["POST /api/mcp", "GET /.well-known/oauth-protected-resource/api/mcp", "GET /.well-known/oauth-authorization-server", "POST /api/mcp/oauth/register"]) {
    assert.ok(seen.includes(step), `the SDK made ${step}`);
  }

  // The person approves; the SDK trades the code.
  const code = await approve(provider.authorizeUrl!);
  assert.equal(await auth(provider as never, { serverUrl, authorizationCode: code, fetchFn: inProcess }), "AUTHORIZED");
  assert.match(provider.saved!.access_token, /^fmcp_at_/);

  const client = await connectFresh();
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name.length > 0), "tools are listed");
  await client.close();

  // The refresh: the SDK swaps its refresh token for new tokens (rotated).
  const before = provider.saved!;
  provider.saved = { access_token: "", refresh_token: before.refresh_token };
  assert.equal(await auth(provider as never, { serverUrl, fetchFn: inProcess }), "AUTHORIZED");
  assert.notEqual(provider.saved!.access_token, before.access_token);
  assert.notEqual(provider.saved!.refresh_token, before.refresh_token, "rotated");

  // Revocation (RFC 7009): the app hands its refresh token back; the access token goes too.
  const meta = (await (await inProcess(`${ORIGIN}/.well-known/oauth-authorization-server`)).json()) as { revocation_endpoint: string };
  const r = await inProcess(meta.revocation_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: provider.saved!.refresh_token!, token_type_hint: "refresh_token", client_id: String(provider.info!.client_id) }).toString(),
  });
  assert.equal(r.status, 200);
  const after = new StreamableHTTPClientTransport(serverUrl, { fetch: (u, i) => inProcess(u, { ...i, headers: { ...Object.fromEntries(new Headers(i?.headers)), authorization: `Bearer ${provider.saved!.access_token}` } }) });
  await assert.rejects(new Client({ name: "after", version: "1.0.0" }).connect(after), /401|Unauthorized|invalid access token/i, "the revoked grant's access token is refused");
});
