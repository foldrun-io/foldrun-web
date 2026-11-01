// MCP over OAuth (1 Nov 2026): the sign-in an AI app such as claude.ai uses
// to reach POST /api/mcp without a pasted key.
//
// The MCP authorization spec (2025-11-25, and the 2025-06-18 and 2025-03-26
// revisions claude.ai speaks) on top of OAuth 2.1:
//
//   /.well-known/oauth-protected-resource[/api/mcp]   RFC 9728: which server signs in for /api/mcp
//   /.well-known/oauth-authorization-server           RFC 8414: the endpoints below, PKCE S256 only
//   POST /api/mcp/oauth/register                      RFC 7591: an app registers itself
//   /mcp/authorize  (page) → POST /api/mcp/oauth/authorize   a signed-in person approves
//   POST /api/mcp/oauth/token                         code → tokens; refresh → new tokens
//   POST /api/mcp/oauth/revoke                        RFC 7009: the app ends its own connection
//   POST /api/mcp/clients                             an admin registers a machine client (client credentials)
//
// An app may also name itself by an https URL (a Client ID Metadata Document):
// the document is fetched through the SSRF guard, and its redirect_uris are
// the only ones it may use.
//
// What a person approves is a *grant*: one app, one account, the workspaces
// and the access (read only, or read and act) they chose, never more than
// their own. Every token is bound to that grant and to /api/mcp (RFC 8707):
// an access token opens /api/mcp and the routes its tools call, and nothing
// else. The grant's role and workspaces are checked against the person's own
// at every use, so a person removed from the account, or moved to viewer,
// takes their apps with them. Revoking the grant ends every token it issued.
// Tokens are stored by SHA-256; refresh tokens rotate, and a rotated one used
// again revokes the grant (OAuth 2.1 §4.3.1: someone has a copy).

import crypto from "node:crypto";
import path from "node:path";
import { dataRoot } from "@/lib/paths.ts";
import { accountDir } from "@/lib/store.ts";
import { keyedStore } from "@/platform/keyed-store.ts";
import { mcpOauthClients, mcpOauthGrants, mcpOauthTokens } from "@/platform/schema.ts";
import { fetchPublic } from "@/platform/ssrf.ts";
import { ROLES, type Role } from "@/platform/permissions.ts";
import { audit } from "./audit.ts";
import { ASSERTION_TYPE, ASSERTION_ALGS, verifyClientAssertion, type Jwk } from "@/lib/oauth-assertion.ts";

export const SCOPES = ["mcp:read", "mcp:write"] as const;
export type Scope = (typeof SCOPES)[number];

export const ACCESS_PREFIX = "fmcp_at_";
export const REFRESH_PREFIX = "fmcp_rt_";
const CODE_PREFIX = "fmcp_ac_";
const CLIENT_PREFIX = "fmcp_c_";
const SECRET_PREFIX = "fmcp_cs_";

export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 10 * 60;
/** A rotated refresh token is remembered this long, so a second use is caught. */
const ROTATED_KEEP_SECONDS = REFRESH_SECONDS;
/** The open registration endpoint's ceiling, install-wide. */
export const MAX_CLIENTS = 5000;
/** Connections one account may hold at once. */
export const MAX_GRANTS = 100;

const INSTALL = "@install";

// ------------------------------------------------------------------ records

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic" | "private_key_jwt";
const AUTH_METHODS: AuthMethod[] = ["none", "client_secret_post", "client_secret_basic", "private_key_jwt"];

export interface ClientRecord {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: AuthMethod;
  /** SHA-256 of the secret, for the two secret methods. */
  secretHash?: string;
  client_uri?: string;
  createdAt: string;
  /** When a person last approved it — an app never approved is the first to go at the cap. */
  lastApprovedAt?: string;
  /** "dcr": registered here; "cimd": described by the document at client_id;
   *  "machine": registered by an admin for client credentials, with a
   *  standing grant (part G) — no person approves each token. */
  kind: "dcr" | "cimd" | "machine";
  /** machine: the account and the grant its tokens speak for. */
  tenant?: string;
  grantId?: string;
  /** private_key_jwt: the app's public keys, inline or at an https URL. */
  jwks?: Jwk[];
  jwks_uri?: string;
}

export interface GrantRecord {
  id: string;
  tenant: string;
  userId: string;
  email: string;
  clientId: string;
  clientName: string;
  /** The host the codes went to — what the person saw on the approval page. */
  redirectHost: string;
  role: Role;
  /** The workspaces it may open; null for every one the person may. */
  workspaces: string[] | null;
  readOnly: boolean;
  scope: string;
  resource: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  /** A machine client's standing grant (client credentials): the person is
   *  the admin who registered it — its role and workspaces are capped by
   *  theirs at every use, as an API key's are. */
  machine?: true;
}

interface TokenRecord {
  /** "jti": a client assertion's id, kept until it expires so it is used once. */
  kind: "code" | "access" | "refresh" | "jti";
  tenant: string;
  clientId: string;
  expiresAt: string;
  /** access, refresh: the grant it speaks for. */
  grantId?: string;
  /** refresh: rotated at — a second use revokes the grant. */
  rotatedAt?: string;
  /** access: the scope this token carries, when narrower than its grant's (a refresh that asked for less). */
  scope?: string;
  /** code: what the token request must repeat, and the grant it becomes. */
  redirectUri?: string;
  codeChallenge?: string;
  pending?: Omit<GrantRecord, "id" | "createdAt" | "tenant">;
}

const clients = keyedStore<ClientRecord>(mcpOauthClients, () => path.join(dataRoot(), ".mcp-oauth-clients.json"));
const grants = keyedStore<GrantRecord>(mcpOauthGrants, (tenant) => path.join(accountDir(tenant), "mcp-oauth-grants.json"));
const tokens = keyedStore<TokenRecord>(mcpOauthTokens, () => path.join(dataRoot(), ".mcp-oauth-tokens.json"));

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const random = (prefix: string) => `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
const iso = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString();
const expired = (at: string | undefined) => !at || Date.parse(at) <= Date.now();

/** An OAuth error as the token and registration endpoints answer it (RFC 6749 §5.2). */
export class OAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, description: string, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------ discovery

/** The issuer, and the one resource its tokens are for. */
export function issuerOf(origin: string): { issuer: string; resource: string } {
  const issuer = origin.replace(/\/+$/, "");
  return { issuer, resource: `${issuer}/api/mcp` };
}

export const resourceMetadataUrl = (origin: string) => `${issuerOf(origin).issuer}/.well-known/oauth-protected-resource/api/mcp`;

/** RFC 9728 — what /api/mcp is, and who signs in for it. */
export function protectedResourceMetadata(origin: string) {
  const { issuer, resource } = issuerOf(origin);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "foldrun",
    resource_documentation: `${issuer}/dashboard/docs/mcp`,
  };
}

/** RFC 8414 — the endpoints and what they accept. */
export function authorizationServerMetadata(origin: string) {
  const { issuer } = issuerOf(origin);
  return {
    issuer,
    authorization_endpoint: `${issuer}/mcp/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_signing_alg_values_supported: [...ASSERTION_ALGS],
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    token_endpoint_auth_signing_alg_values_supported: [...ASSERTION_ALGS],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/dashboard/docs/mcp`,
  };
}

/** The resource a request names, compared the way RFC 8707 asks: scheme and
 *  host without regard to case, no trailing slash. Unsaid is ours (the
 *  2025-03-26 revision did not send it). */
export function resourceMatches(asked: string | null | undefined, origin: string): boolean {
  if (asked === null || asked === undefined || asked === "") return true;
  const ours = issuerOf(origin).resource;
  try {
    const a = new URL(asked);
    const b = new URL(ours);
    if (a.hash || a.search) return false;
    return a.protocol === b.protocol && a.host.toLowerCase() === b.host.toLowerCase() && a.pathname.replace(/\/+$/, "") === b.pathname;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ clients

/** A redirect URI an app may register: https, or http to this machine
 *  (a desktop app's loopback listener). No fragment, nothing to carry a token in. */
export function redirectProblem(uri: unknown): string | null {
  if (typeof uri !== "string" || uri.length > 2000) return "a redirect URI is a string of at most 2,000 characters";
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `${uri} is not a URL`;
  }
  if (u.hash) return `${uri}: a redirect URI has no fragment`;
  if (u.username || u.password) return `${uri}: a redirect URI carries no credentials`;
  if (u.protocol === "https:") return null;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol === "http:" && loopback) return null;
  return `${uri}: a redirect URI is https, or http to localhost`;
}

/** RFC 7591 — an app registers itself. Open, so bounded: names, URIs and the count. */
export async function registerClient(body: unknown): Promise<Record<string, unknown>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new OAuthError("invalid_client_metadata", "expected a JSON object");
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "redirect_uris: one to ten URIs");
  for (const u of uris) {
    const why = redirectProblem(u);
    if (why) throw new OAuthError("invalid_redirect_uri", why);
  }
  const method = (b.token_endpoint_auth_method ?? "client_secret_basic") as string;
  if (!(AUTH_METHODS as string[]).includes(method)) {
    throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method is ${AUTH_METHODS.join(", ")}`);
  }
  const keys = method === "private_key_jwt" ? keysOf(b) : {};
  const grantTypes = (b.grant_types ?? ["authorization_code"]) as unknown;
  if (!Array.isArray(grantTypes) || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "grant_types: authorization_code and refresh_token only");
  }
  const responseTypes = (b.response_types ?? ["code"]) as unknown;
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "response_types: code only");
  const name = typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : "An unnamed app";
  const clientUri = typeof b.client_uri === "string" && /^https:\/\//.test(b.client_uri) ? b.client_uri.slice(0, 500) : undefined;
  const all = await clients.all(INSTALL);
  if (Object.keys(all).length >= MAX_CLIENTS) {
    // At the ceiling, make room from registrations nobody ever approved and
    // that are a day old — what a flood of registrations leaves behind —
    // rather than turning every new app away.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    // Only self-registered apps: an admin's machine client is never "stale".
    const stale = Object.values(all).filter((c) => c.kind === "dcr" && !c.lastApprovedAt && Date.parse(c.createdAt) < dayAgo).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of stale.slice(0, 100)) await clients.remove(INSTALL, c.client_id);
    if (!stale.length) throw new OAuthError("temporarily_unavailable", "this install holds as many registered apps as it takes", 503);
  }
  const client_id = random(CLIENT_PREFIX);
  const secret = method === "none" || method === "private_key_jwt" ? undefined : random(SECRET_PREFIX);
  const record: ClientRecord = {
    client_id,
    client_name: name,
    redirect_uris: uris as string[],
    token_endpoint_auth_method: method as AuthMethod,
    ...(secret ? { secretHash: sha(secret) } : {}),
    ...(clientUri ? { client_uri: clientUri } : {}),
    ...keys,
    createdAt: new Date().toISOString(),
    kind: "dcr",
  };
  await clients.put(INSTALL, client_id, record);
  return {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: record.redirect_uris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: method,
    ...(clientUri ? { client_uri: clientUri } : {}),
    ...(keys.jwks ? { jwks: { keys: keys.jwks } } : {}),
    ...(keys.jwks_uri ? { jwks_uri: keys.jwks_uri } : {}),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

/** A private_key_jwt app's keys from its metadata: `jwks` ({ keys: [...] },
 *  public keys only, at most 10) or an https `jwks_uri` — one, not both. */
function keysOf(b: Record<string, unknown>): { jwks?: Jwk[]; jwks_uri?: string } {
  const inline = b.jwks as { keys?: unknown } | undefined;
  const uri = b.jwks_uri;
  if (inline !== undefined && uri !== undefined) throw new OAuthError("invalid_client_metadata", "jwks or jwks_uri, not both");
  if (uri !== undefined) {
    if (typeof uri !== "string" || !/^https:\/\//.test(uri) || uri.length > 2000) throw new OAuthError("invalid_client_metadata", "jwks_uri is an https URL");
    return { jwks_uri: uri };
  }
  const list = inline && typeof inline === "object" ? inline.keys : undefined;
  if (!Array.isArray(list) || !list.length || list.length > 10) throw new OAuthError("invalid_client_metadata", "private_key_jwt needs jwks ({ keys: [...] }, one to ten) or jwks_uri");
  for (const k of list) {
    if (!k || typeof k !== "object" || typeof (k as Jwk).kty !== "string") throw new OAuthError("invalid_client_metadata", "each jwks key is a JWK");
    if ("d" in (k as Jwk) || "p" in (k as Jwk) || "k" in (k as Jwk)) throw new OAuthError("invalid_client_metadata", "jwks holds public keys only — a private or symmetric key was sent");
  }
  return { jwks: list as Jwk[] };
}

const cimdCache = new Map<string, { at: number; record: ClientRecord }>();
const CIMD_TTL_MS = 5 * 60 * 1000;

/** An https client_id with a path: its own metadata document (CIMD). */
export const isMetadataUrl = (clientId: string) => {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname.length > 1 && !u.hash;
  } catch {
    return false;
  }
};

/** The app a client_id names: registered here, or described at its URL. */
export async function resolveClient(clientId: string): Promise<ClientRecord> {
  if (typeof clientId !== "string" || !clientId) throw new OAuthError("invalid_request", "client_id is required");
  if (clientId.startsWith(CLIENT_PREFIX)) {
    const c = await clients.get(INSTALL, clientId);
    if (!c) throw new OAuthError("invalid_client", "no app is registered with this client_id", 401);
    return c;
  }
  if (!isMetadataUrl(clientId)) throw new OAuthError("invalid_client", "a client_id is one this server issued, or an https URL to the app's metadata document", 401);
  const hit = cimdCache.get(clientId);
  if (hit && Date.now() - hit.at < CIMD_TTL_MS) return hit.record;
  let doc: Record<string, unknown>;
  try {
    const res = await fetchPublic(clientId, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) }, { maxBytes: 16_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new OAuthError("invalid_client", `could not read the app's metadata document at ${clientId}: ${err instanceof Error ? err.message : String(err)}`, 401);
  }
  if (doc.client_id !== clientId) throw new OAuthError("invalid_client", "the metadata document's client_id is not its own URL", 401);
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.some((u) => redirectProblem(u))) throw new OAuthError("invalid_client", "the metadata document's redirect_uris are missing or not allowed", 401);
  const method = (doc.token_endpoint_auth_method ?? "none") as string;
  if (method !== "none" && method !== "private_key_jwt") throw new OAuthError("invalid_client", "an app named by its metadata document authenticates with PKCE alone or with private_key_jwt (token_endpoint_auth_method: none or private_key_jwt)", 401);
  let docKeys: { jwks?: Jwk[]; jwks_uri?: string } = {};
  if (method === "private_key_jwt") {
    try {
      docKeys = keysOf(doc);
    } catch (err) {
      throw new OAuthError("invalid_client", `the metadata document's keys: ${err instanceof Error ? err.message : String(err)}`, 401);
    }
  }
  const record: ClientRecord = {
    client_id: clientId,
    client_name: typeof doc.client_name === "string" && doc.client_name.trim() ? doc.client_name.trim().slice(0, 100) : new URL(clientId).host,
    redirect_uris: uris as string[],
    token_endpoint_auth_method: method as AuthMethod,
    ...docKeys,
    createdAt: new Date().toISOString(),
    kind: "cimd",
  };
  cimdCache.set(clientId, { at: Date.now(), record });
  return record;
}

// ------------------------------------------------------------------ authorize

export interface AuthorizeRequest {
  client: ClientRecord;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: Scope[];
  resource: string;
}

/**
 * Check an authorization request. Two kinds of failure, as RFC 6749 §4.1.2.1
 * asks: one that must never be redirected (an unknown app, a redirect URI it
 * did not register) throws `redirect: false`; the rest are sent back to the
 * app with `redirect: true`.
 */
export async function checkAuthorizeRequest(q: URLSearchParams, origin: string): Promise<AuthorizeRequest> {
  const fail = (code: string, why: string, redirect: boolean) => Object.assign(new OAuthError(code, why), { redirect });
  let client: ClientRecord;
  try {
    client = await resolveClient(q.get("client_id") ?? "");
  } catch (err) {
    throw fail("invalid_client", err instanceof Error ? err.message : String(err), false);
  }
  const asked = q.get("redirect_uri");
  const redirectUri = asked ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : null);
  if (!redirectUri) throw fail("invalid_request", "redirect_uri is required when an app registered more than one", false);
  // Exact match, as OAuth 2.1 requires — except a loopback port, which a
  // desktop app picks when it starts (RFC 8252 §7.3).
  const ok = client.redirect_uris.some((r) => r === redirectUri || loopbackMatch(r, redirectUri));
  if (!ok) throw fail("invalid_request", "redirect_uri is not one this app registered", false);
  if (q.get("response_type") !== "code") throw fail("unsupported_response_type", "response_type is code", true);
  const challenge = q.get("code_challenge");
  if (!challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw fail("invalid_request", "a PKCE code_challenge is required", true);
  if ((q.get("code_challenge_method") ?? "plain") !== "S256") throw fail("invalid_request", "code_challenge_method is S256", true);
  const resource = q.get("resource");
  if (!resourceMatches(resource, origin)) throw fail("invalid_target", `this server signs in for ${issuerOf(origin).resource} only`, true);
  const scopes = (q.get("scope") ?? "").split(/\s+/).filter(Boolean);
  if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) throw fail("invalid_scope", `scopes are ${SCOPES.join(" and ")}`, true);
  return {
    client,
    redirectUri,
    state: q.get("state"),
    codeChallenge: challenge,
    scope: (scopes.length ? scopes : [...SCOPES]) as Scope[],
    resource: issuerOf(origin).resource,
  };
}

function loopbackMatch(registered: string, asked: string): boolean {
  try {
    const a = new URL(registered);
    const b = new URL(asked);
    const loop = (u: URL) => u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return loop(a) && loop(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** Where the person's answer goes: the app's redirect URI with the code (or the error), state and iss. */
export function redirectWith(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** The person approved: a one-time code for what they chose. */
export async function issueCode(req: AuthorizeRequest, who: { tenant: string; userId: string; email: string; role: Role; workspaces: string[] | null; readOnly: boolean }): Promise<string> {
  const code = random(CODE_PREFIX);
  if (req.client.kind === "dcr") {
    await clients.update(INSTALL, req.client.client_id, (cur) => (cur ? { ...cur, lastApprovedAt: new Date().toISOString() } : null));
  }
  const readOnly = who.readOnly || !req.scope.includes("mcp:write");
  await tokens.put(INSTALL, sha(code), {
    kind: "code",
    tenant: who.tenant,
    clientId: req.client.client_id,
    expiresAt: iso(CODE_SECONDS),
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    pending: {
      userId: who.userId,
      email: who.email,
      clientId: req.client.client_id,
      clientName: req.client.client_name,
      redirectHost: new URL(req.redirectUri).host,
      role: who.role,
      workspaces: who.workspaces,
      readOnly,
      scope: readOnly ? "mcp:read" : "mcp:read mcp:write",
      resource: req.resource,
    },
  });
  return code;
}

// ------------------------------------------------------------------ token

const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();

/** A private_key_jwt app's public keys: inline, or its jwks_uri through the
 *  SSRF guard, cached five minutes and fetched again once on a kid it lacks. */
async function clientKeys(client: ClientRecord, kid: string | undefined): Promise<Jwk[]> {
  if (client.jwks) return client.jwks;
  if (!client.jwks_uri) return [];
  const hit = jwksCache.get(client.jwks_uri);
  if (hit && Date.now() - hit.at < CIMD_TTL_MS && (!kid || hit.keys.some((k) => k.kid === kid))) return hit.keys;
  try {
    const res = await fetchPublic(client.jwks_uri, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) }, { maxBytes: 64_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = (await res.json()) as { keys?: unknown };
    const keys = Array.isArray(doc.keys) ? (doc.keys.filter((k) => k && typeof k === "object" && !("d" in k)) as Jwk[]) : [];
    jwksCache.set(client.jwks_uri, { at: Date.now(), keys });
    return keys;
  } catch (err) {
    throw new OAuthError("invalid_client", `could not read the app's keys at ${client.jwks_uri}: ${err instanceof Error ? err.message : String(err)}`, 401);
  }
}

/** A signed client assertion (RFC 7523): verified against the app's keys,
 *  for this server, short-lived, and its jti used once. */
async function authenticateAssertion(form: URLSearchParams, origin: string): Promise<ClientRecord> {
  if (form.get("client_assertion_type") !== ASSERTION_TYPE) throw new OAuthError("invalid_client", `client_assertion_type is ${ASSERTION_TYPE}`, 401);
  const assertion = form.get("client_assertion") ?? "";
  let iss: unknown;
  let kid: string | undefined;
  try {
    const [h, c] = assertion.split(".");
    kid = (JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { kid?: string }).kid;
    iss = (JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as { iss?: unknown }).iss;
  } catch {
    throw new OAuthError("invalid_client", "the client assertion is not a JWT", 401);
  }
  const given = form.get("client_id");
  if (given && iss !== given) throw new OAuthError("invalid_client", "the client assertion's iss is not the client_id", 401);
  const client = await resolveClient(given ?? (typeof iss === "string" ? iss : ""));
  if (client.token_endpoint_auth_method !== "private_key_jwt") throw new OAuthError("invalid_client", "this app does not authenticate with private_key_jwt", 401);
  const { issuer } = issuerOf(origin);
  let verified;
  try {
    verified = verifyClientAssertion(assertion, {
      clientId: client.client_id,
      // The issuer, or the endpoint it was sent to (RFC 7523 §3; its successor names the issuer).
      audiences: [issuer, `${issuer}/api/mcp/oauth/token`, `${issuer}/api/mcp/oauth/revoke`],
      keys: await clientKeys(client, kid),
    });
  } catch (err) {
    if (err instanceof OAuthError) throw err;
    throw new OAuthError("invalid_client", err instanceof Error ? err.message : String(err), 401);
  }
  // Used once: the jti is claimed with an insert that only one of two racing
  // requests can win (keyedStore.claim), and kept until the assertion
  // expires; the hourly sweep drops it after.
  const claimed = await tokens.claim(INSTALL, sha(`jti:${client.client_id}:${verified.jti}`), {
    kind: "jti", tenant: "", clientId: client.client_id, expiresAt: new Date((verified.exp + 60) * 1000).toISOString(),
  });
  if (!claimed) throw new OAuthError("invalid_client", "this client assertion was already used — sign a new one (its jti is used once)", 401);
  return client;
}

/** How the app proved itself at the token endpoint. */
async function authenticateClient(form: URLSearchParams, authorization: string | null, origin: string): Promise<ClientRecord> {
  if (form.has("client_assertion") || form.has("client_assertion_type")) {
    // One method per request (RFC 6749 §2.3).
    if (form.has("client_secret") || (authorization && /^basic\s/i.test(authorization))) throw new OAuthError("invalid_request", "a client assertion and a client secret in one request — use one");
    return authenticateAssertion(form, origin);
  }
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  if (authorization && /^basic\s/i.test(authorization)) {
    const raw = Buffer.from(authorization.replace(/^basic\s+/i, ""), "base64").toString("utf8");
    const i = raw.indexOf(":");
    if (i < 0) throw new OAuthError("invalid_client", "a Basic header is client_id:client_secret", 401);
    id = decodeURIComponent(raw.slice(0, i));
    secret = decodeURIComponent(raw.slice(i + 1));
  }
  if (!id) throw new OAuthError("invalid_client", "client_id is required", 401);
  const client = await resolveClient(id);
  if (client.token_endpoint_auth_method === "private_key_jwt") throw new OAuthError("invalid_client", "this app authenticates with a signed client assertion (private_key_jwt)", 401);
  if (client.token_endpoint_auth_method !== "none") {
    if (!secret || !client.secretHash || !crypto.timingSafeEqual(Buffer.from(sha(secret)), Buffer.from(client.secretHash))) {
      throw new OAuthError("invalid_client", "the client secret did not match", 401);
    }
  }
  return client;
}

export interface TokenAnswer {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  /** Absent for client credentials: the client asks again (RFC 6749 §4.4.3). */
  refresh_token?: string;
  scope: string;
}

let lastSweep = 0;

async function mint(grant: GrantRecord, clientId: string, accessScope = grant.scope, opts: { refresh?: boolean } = {}): Promise<TokenAnswer> {
  if (Date.now() - lastSweep > 60 * 60 * 1000) {
    lastSweep = Date.now();
    await sweepTokens().catch(() => undefined);
  }
  const access = random(ACCESS_PREFIX);
  await tokens.put(INSTALL, sha(access), { kind: "access", tenant: grant.tenant, clientId, grantId: grant.id, expiresAt: iso(ACCESS_SECONDS), ...(accessScope !== grant.scope ? { scope: accessScope } : {}) });
  if (opts.refresh === false) return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: accessScope };
  const refresh = random(REFRESH_PREFIX);
  await tokens.put(INSTALL, sha(refresh), { kind: "refresh", tenant: grant.tenant, clientId, grantId: grant.id, expiresAt: iso(REFRESH_SECONDS) });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: accessScope };
}

/** POST /api/mcp/oauth/token — a code for tokens, or a refresh token for new ones. */
export async function tokenRequest(form: URLSearchParams, authorization: string | null, origin: string): Promise<TokenAnswer> {
  const client = await authenticateClient(form, authorization, origin);
  const type = form.get("grant_type");
  if (type === "authorization_code") {
    const code = form.get("code") ?? "";
    // Good once (OAuth 2.1 §4.1.3): of two requests with the same code, only
    // the one whose delete removed the row goes on.
    // Only an authorization code is ever consumed here: a refresh token sent
    // as a `code` must not delete the marker that catches its reuse.
    const taken = code.startsWith(CODE_PREFIX) ? await tokens.get(INSTALL, sha(code)) : undefined;
    if (!taken || taken.kind !== "code") throw new OAuthError("invalid_grant", "the code is unknown, used or expired");
    if (!(await tokens.remove(INSTALL, sha(code)))) throw new OAuthError("invalid_grant", "the code is unknown, used or expired");
    if (!taken || taken.kind !== "code" || expired(taken.expiresAt) || !taken.pending) throw new OAuthError("invalid_grant", "the code is unknown, used or expired");
    if (taken.clientId !== client.client_id) throw new OAuthError("invalid_grant", "the code was issued to another app");
    if ((form.get("redirect_uri") ?? taken.redirectUri) !== taken.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the one the code was sent to");
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "a code_verifier is required");
    const derived = crypto.createHash("sha256").update(verifier).digest("base64url");
    if (derived !== taken.codeChallenge) throw new OAuthError("invalid_grant", "the code_verifier does not match the code_challenge");
    if (!resourceMatches(form.get("resource"), origin)) throw new OAuthError("invalid_target", `tokens here are for ${issuerOf(origin).resource} only`);
    const held = Object.values(await grants.all(taken.tenant)).filter((g) => !g.revokedAt).length;
    if (held >= MAX_GRANTS) throw new OAuthError("access_denied", `this account holds ${MAX_GRANTS} connected apps — revoke one in Settings → API keys`);
    const grant: GrantRecord = { ...taken.pending, id: crypto.randomBytes(9).toString("base64url"), tenant: taken.tenant, createdAt: new Date().toISOString() };
    await grants.put(grant.tenant, grant.id, grant);
    return mint(grant, client.client_id);
  }
  if (type === "refresh_token") {
    const presented = form.get("refresh_token") ?? "";
    const key = sha(presented);
    const t = await tokens.get(INSTALL, key);
    if (!t || t.kind !== "refresh" || !t.grantId) throw new OAuthError("invalid_grant", "the refresh token is unknown");
    if (t.clientId !== client.client_id) throw new OAuthError("invalid_grant", "the refresh token was issued to another app");
    if (t.rotatedAt) {
      // Used before: whoever holds this copy is not the app it was rotated
      // for. End the connection; the person connects again.
      await revokeGrant(t.tenant, t.grantId, "refresh token reused");
      throw new OAuthError("invalid_grant", "the refresh token was already used — the connection is revoked; connect the app again");
    }
    if (expired(t.expiresAt)) throw new OAuthError("invalid_grant", "the refresh token has expired — connect the app again");
    const grant = await grants.get(t.tenant, t.grantId);
    if (!grant || grant.revokedAt) throw new OAuthError("invalid_grant", "the connection was revoked — connect the app again");
    if (!resourceMatches(form.get("resource"), origin)) throw new OAuthError("invalid_target", `tokens here are for ${issuerOf(origin).resource} only`);
    // RFC 6749 §6: a refresh may ask for less than the connection holds, never more.
    const held = grant.scope.split(" ");
    const asked = (form.get("scope") ?? "").split(/\s+/).filter(Boolean);
    if (asked.some((s) => !held.includes(s))) throw new OAuthError("invalid_scope", `this connection holds ${grant.scope} — a refresh can ask for less, not more`);
    const accessScope = asked.length ? [...SCOPES].filter((s) => asked.includes(s)).join(" ") : grant.scope;
    let rotated = false;
    await tokens.update(INSTALL, key, (cur) => {
      if (!cur || cur.rotatedAt) return null;
      rotated = true;
      return { ...cur, rotatedAt: new Date().toISOString(), expiresAt: iso(ROTATED_KEEP_SECONDS) };
    });
    if (!rotated) {
      await revokeGrant(t.tenant, t.grantId, "refresh token reused");
      throw new OAuthError("invalid_grant", "the refresh token was already used — the connection is revoked; connect the app again");
    }
    return mint(grant, client.client_id, accessScope);
  }
  if (type === "client_credentials") {
    // A machine client's standing grant (part G): no person, no refresh token.
    if (client.kind !== "machine" || !client.tenant || !client.grantId) throw new OAuthError("unauthorized_client", "client credentials are for machine clients an admin registers in Settings → API keys");
    const grant = await grants.get(client.tenant, client.grantId);
    if (!grant || grant.revokedAt) throw new OAuthError("invalid_client", "this machine client was disconnected", 401);
    if (!resourceMatches(form.get("resource"), origin)) throw new OAuthError("invalid_target", `tokens here are for ${issuerOf(origin).resource} only`);
    const held = grant.scope.split(" ");
    const asked = (form.get("scope") ?? "").split(/\s+/).filter(Boolean);
    if (asked.some((s) => !held.includes(s))) throw new OAuthError("invalid_scope", `this machine client holds ${grant.scope} — it can ask for less, not more`);
    const accessScope = asked.length ? [...SCOPES].filter((s) => asked.includes(s)).join(" ") : grant.scope;
    return mint(grant, client.client_id, accessScope, { refresh: false });
  }
  throw new OAuthError("unsupported_grant_type", "grant_type is authorization_code, refresh_token or client_credentials");
}

/**
 * An admin registers a machine client (part G): a client id and either a
 * secret (shown once) or its public keys (private_key_jwt), and a standing
 * grant with the role, workspaces and access they chose — never more than
 * their own, and capped by theirs again at every use. Listed with the
 * connected apps; disconnecting it removes the client, so its next token
 * request is invalid_client.
 */
export async function registerMachineClient(input: {
  tenant: string; userId: string; email: string; origin: string;
  name: string; role: Role; workspaces: string[] | null; readOnly: boolean;
  auth: "client_secret_basic" | "client_secret_post" | "private_key_jwt";
  jwks?: unknown; jwks_uri?: unknown;
}): Promise<{ client_id: string; client_secret?: string; grant: string; token_endpoint_auth_method: AuthMethod }> {
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new OAuthError("invalid_client_metadata", "a machine client needs a name");
  const held = Object.values(await grants.all(input.tenant)).filter((g) => !g.revokedAt).length;
  if (held >= MAX_GRANTS) throw new OAuthError("access_denied", `this account holds ${MAX_GRANTS} connected apps — disconnect one first`);
  const keys = input.auth === "private_key_jwt" ? keysOf({ ...(input.jwks !== undefined ? { jwks: input.jwks } : {}), ...(input.jwks_uri !== undefined ? { jwks_uri: input.jwks_uri } : {}) }) : {};
  const client_id = random(CLIENT_PREFIX);
  const secret = input.auth === "private_key_jwt" ? undefined : random(SECRET_PREFIX);
  const grant: GrantRecord = {
    id: crypto.randomBytes(9).toString("base64url"),
    tenant: input.tenant,
    userId: input.userId,
    email: input.email,
    clientId: client_id,
    clientName: name,
    redirectHost: "client credentials",
    role: input.role,
    workspaces: input.workspaces,
    readOnly: input.readOnly,
    scope: input.readOnly ? "mcp:read" : "mcp:read mcp:write",
    resource: issuerOf(input.origin).resource,
    createdAt: new Date().toISOString(),
    machine: true,
  };
  await clients.put(INSTALL, client_id, {
    client_id, client_name: name, redirect_uris: [], token_endpoint_auth_method: input.auth,
    ...(secret ? { secretHash: sha(secret) } : {}), ...keys,
    createdAt: grant.createdAt, kind: "machine", tenant: input.tenant, grantId: grant.id,
  });
  await grants.put(input.tenant, grant.id, grant);
  await audit("mcp.connected", { actor: input.email, tenant: input.tenant, subject: name, detail: { grant: grant.id, machine: true, role: input.role, access: input.readOnly ? "read" : "write", workspaces: input.workspaces } }).catch(() => undefined);
  return { client_id, ...(secret ? { client_secret: secret } : {}), grant: grant.id, token_endpoint_auth_method: input.auth };
}

/**
 * POST /api/mcp/oauth/revoke (RFC 7009): an app hands back one of its tokens.
 * The app authenticates as at the token endpoint. Revoking either token of a
 * connection ends the connection — every token its grant issued — since an
 * app that throws away its access token has no use for the refresh token
 * either. A token that is unknown, expired or already revoked is answered
 * 200 (§2.2); one issued to another app is refused.
 */
export async function revokeRequest(form: URLSearchParams, authorization: string | null, origin: string): Promise<void> {
  const client = await authenticateClient(form, authorization, origin);
  const token = form.get("token");
  if (!token) throw new OAuthError("invalid_request", "token is required");
  // token_type_hint is only a hint: an unknown one is ignored (§2.1).
  // Only tokens of these two kinds are revocable here: an authorization code
  // sent as a token is not looked up, so it cannot be used to probe.
  if (!token.startsWith(ACCESS_PREFIX) && !token.startsWith(REFRESH_PREFIX)) return;
  const t = await tokens.get(INSTALL, sha(token));
  if (!t || (t.kind !== "access" && t.kind !== "refresh") || !t.grantId) return;
  if (t.clientId !== client.client_id) throw new OAuthError("unauthorized_client", "this token was issued to another app");
  await revokeGrant(t.tenant, t.grantId, `${client.client_name} (revocation endpoint)`);
}

// ------------------------------------------------------------------ the resource side

export interface ResolvedToken {
  grant: GrantRecord;
}

/** An access token presented to /api/mcp: its grant, or why not. */
export async function resolveAccessToken(token: string): Promise<{ ok: true; grant: GrantRecord; readOnly: boolean } | { ok: false; message: string }> {
  const t = await tokens.get(INSTALL, sha(token));
  if (!t || t.kind !== "access" || !t.grantId) return { ok: false, message: "invalid access token" };
  if (expired(t.expiresAt)) return { ok: false, message: "the access token has expired — refresh it" };
  const grant = await grants.get(t.tenant, t.grantId);
  if (!grant || grant.revokedAt) return { ok: false, message: "this app's connection was revoked" };
  if (!grant.lastUsedAt || Date.now() - Date.parse(grant.lastUsedAt) > 10 * 60 * 1000) {
    await grants.update(grant.tenant, grant.id, (cur) => (cur && !cur.revokedAt ? { ...cur, lastUsedAt: new Date().toISOString() } : null)).catch(() => undefined);
  }
  // Read only by the person's choice, or because this token was refreshed with less.
  const readOnly = grant.readOnly || !(t.scope ?? grant.scope).split(" ").includes("mcp:write");
  return { ok: true, grant, readOnly };
}

/** The lower of two roles. */
export function lowerRole(a: Role, b: Role): Role {
  return ROLES.indexOf(a) <= ROLES.indexOf(b) ? a : b;
}

/** The workspaces both may open (null: all). */
export function intersectWorkspaces(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.filter((w) => b.includes(w));
}

// ------------------------------------------------------------------ connections

/** A connection as the API, Settings and the CLI show it. */
export interface ConnectionView {
  id: string;
  client: string;
  clientId: string;
  redirectHost: string;
  person: string;
  role: Role;
  workspaces: string[] | null;
  access: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** A machine client (client credentials), not an app a person signed in. */
  machine: boolean;
}

export const connectionView = (g: GrantRecord): ConnectionView => ({
  id: g.id,
  client: g.clientName,
  clientId: g.clientId,
  redirectHost: g.redirectHost,
  person: g.email,
  role: g.role,
  workspaces: g.workspaces,
  access: g.readOnly ? "read" : "write",
  createdAt: g.createdAt,
  lastUsedAt: g.lastUsedAt ?? null,
  revokedAt: g.revokedAt ?? null,
  machine: g.machine === true,
});

/** The account's connected apps, newest first — what Settings and the CLI list. */
export async function listGrants(tenant: string, opts: { all?: boolean } = {}): Promise<GrantRecord[]> {
  return Object.values(await grants.all(tenant))
    .filter((g) => opts.all || !g.revokedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGrant(tenant: string, id: string): Promise<GrantRecord | undefined> {
  return grants.get(tenant, id);
}

/** End a connection: the grant is marked, and every token it issued is deleted. */
export async function revokeGrant(tenant: string, id: string, by: string): Promise<GrantRecord | undefined> {
  const done = await grants.update(tenant, id, (cur) => (cur && !cur.revokedAt ? { ...cur, revokedAt: new Date().toISOString(), revokedBy: by } : null));
  const all = await tokens.all(INSTALL);
  for (const [key, t] of Object.entries(all)) {
    if (t.tenant === tenant && t.grantId === id) await tokens.remove(INSTALL, key);
  }
  // A machine client goes with its grant: its next token request is invalid_client.
  if (done?.machine) await clients.remove(INSTALL, done.clientId).catch(() => false);
  if (done) await audit("mcp.revoked", { actor: by, tenant, subject: done.clientName, detail: { grant: id, person: done.email } }).catch(() => undefined);
  return done;
}

/** Drop what has expired: codes, tokens, and rotated refresh tokens past their watch. */
export async function sweepTokens(): Promise<number> {
  let n = 0;
  for (const [key, t] of Object.entries(await tokens.all(INSTALL))) {
    if (expired(t.expiresAt)) {
      await tokens.remove(INSTALL, key);
      n++;
    }
  }
  return n;
}

/** For tests: forget the cached metadata documents. */
export function _resetMcpOauthCaches(): void {
  cimdCache.clear();
  jwksCache.clear();
}
