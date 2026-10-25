import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requirePermission, assertWorkspaceScope } from "@/server/api";
import { audit } from "@/server/audit";
import {
  listSecrets, setSecret, deleteSecret, setOAuth2Secret, setServiceAccountSecret, setFileSecret,
  setSshSecret, setApiSecret, setClientCertSecret, setIdentitySecret, setSecretSites,
  type OAuth2Config, type ServiceAccountConfig, type SshConfig, type ApiConfig, type ClientCertConfig, type IdentityConfig,
} from "@/lib/secrets";
import { secretHealth, forgetSecretHealth, healthKey } from "@/lib/secret-health";
import { rememberConnection } from "@/platform/oauth-connections";
import { idempotent } from "@/server/idempotency";

// Two scopes: without a workspace these operate on the account store, with one
// on that workspace's own. Values are write-only — this endpoint returns
// names, scopes and timestamps, never a value.

// `workspace` is the current spelling; `project` is what callers written before
// the rename still send, and dropping it would break them silently — a secret
// would land at account scope instead of the workspace's.
function scopeOf(req: NextRequest, body?: { workspace?: string; project?: string }) {
  const q = req.nextUrl.searchParams;
  return body?.workspace ?? body?.project ?? q.get("workspace") ?? q.get("project") ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const scope = scopeOf(req);
    assertWorkspaceScope(actor, scope);
    const health = await secretHealth(tenant);
    // The vault knows a name; only the places that USE a credential know
    // whether it still works. A secret nothing has used yet has no health
    // and gets none — unused is not the same as broken, and inventing a
    // green tick for one would be the worst of the three answers.
    // A scoped caller sees its workspace's own entries, not the account's.
    const entries = listSecrets(tenant, scope).filter((s) => actor.workspaces === null || s.scope === "workspace");
    return NextResponse.json({
      // Keyed by the entry it actually is: an account API_KEY and a
      // workspace API_KEY are two credentials, and one's refusal must not
      // show on the other.
      secrets: entries.map((s) => ({
        ...s,
        health: health[healthKey(s.name, s.scope === "workspace" ? "workspace" : "account", scope)] ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function putOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json()) as {
      name?: string;
      value?: string;
      oauth2?: OAuth2Config;
      service_account?: ServiceAccountConfig;
      file?: string;
      ssh?: SshConfig;
      api?: ApiConfig;
      /** A client certificate for mutual TLS: { cert, key, passphrase?, export? }. */
      client_cert?: ClientCertConfig;
      /** A keyless cloud identity: { audience } — no credential at all. */
      identity?: IdentityConfig;
      workspace?: string;
      project?: string;
      /** With oauth2: the scopes consented to and how long the refresh
       *  token lasts — kept so the connection can be reconnected in a click. */
      scopes?: string;
      refresh_token_expires_in?: number;
      /** Bind it to these sites as it is set — see PATCH. */
      sites?: string[];
    };
    if (!body.name) return NextResponse.json({ error: "expected { name }" }, { status: 400 });
    if (body.sites !== undefined && !isSiteList(body.sites)) return NextResponse.json({ error: "sites is a list of domains, like [\"api.example.com\", \"*.example.com\"]" }, { status: 400 });
    const scope = scopeOf(req, body);
    assertWorkspaceScope(actor, scope);
    if (body.oauth2) {
      setOAuth2Secret(tenant, body.name, body.oauth2, scope);
      if (body.oauth2.grant_type !== "client_credentials") {
        await rememberConnection(tenant, body.name, scope, { ...body.oauth2, scopes: body.scopes }, {
          refreshExpiresIn: body.refresh_token_expires_in,
        });
      }
    }
    else if (body.service_account) setServiceAccountSecret(tenant, body.name, body.service_account, scope);
    else if (body.ssh) setSshSecret(tenant, body.name, body.ssh, scope);
    else if (body.api) setApiSecret(tenant, body.name, body.api, scope);
    else if (body.client_cert) setClientCertSecret(tenant, body.name, body.client_cert, scope);
    else if (body.identity) setIdentitySecret(tenant, body.name, body.identity, scope);
    else if (typeof body.file === "string") setFileSecret(tenant, body.name, body.file, scope);
    else if (typeof body.value === "string" && body.value !== "") setSecret(tenant, body.name, body.value, scope);
    else return NextResponse.json({ error: "expected a value, oauth2, service_account, ssh, api, client_cert, identity, or file" }, { status: 400 });
    const sites = body.sites !== undefined ? setSecretSites(tenant, body.name, body.sites, scope) : undefined;
    // A rotation is a new credential under an old name. Carrying the old
    // one's refusals forward would show a freshly-fixed key as still broken,
    // which is the moment someone stops trusting the indicator.
    await forgetSecretHealth(tenant, healthKey(body.name, scope ? "workspace" : "account", scope));
    // The name and the kind, never the value.
    const kind = body.oauth2 ? "oauth2" : body.service_account ? "service_account" : body.ssh ? "ssh" : body.api ? "api" : body.client_cert ? "client_cert" : body.identity ? "identity" : typeof body.file === "string" ? "file" : "value";
    await audit("secret.set", { actor: actor.name, tenant, subject: body.name, detail: { name: body.name, kind, ...(scope ? { workspace: scope } : {}), ...(sites ? { sites } : {}) } });
    return NextResponse.json({
      ok: true,
      name: body.name,
      scope: scope ? "workspace" : "account",
      ...(sites ? { sites } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json()) as { name?: string; workspace?: string; project?: string };
    if (!body.name) return NextResponse.json({ error: "expected { name }" }, { status: 400 });
    const scope = scopeOf(req, body);
    assertWorkspaceScope(actor, scope);
    deleteSecret(tenant, body.name, scope);
    await forgetSecretHealth(tenant, healthKey(body.name, scope ? "workspace" : "account", scope));
    await audit("secret.deleted", { actor: actor.name, tenant, subject: body.name, detail: { name: body.name, ...(scope ? { workspace: scope } : {}) } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

function isSiteList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Bind a secret to sites, or unbind it (`sites: []`). A bound secret never
 * enters a sandbox: the egress proxy fills its `${NAME}` for those sites
 * alone, in a request's URL and headers (foldrun-core egress.ts). The value
 * is untouched; the secret must already exist in that scope.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "secrets:write");
    const body = (await req.json()) as { name?: string; sites?: unknown; workspace?: string; project?: string };
    if (!body.name) return NextResponse.json({ error: "expected { name, sites }" }, { status: 400 });
    if (!isSiteList(body.sites)) return NextResponse.json({ error: "sites is a list of domains, like [\"api.example.com\", \"*.example.com\"]; [] unbinds" }, { status: 400 });
    const scope = scopeOf(req, body);
    assertWorkspaceScope(actor, scope);
    let sites: string[];
    try {
      sites = setSecretSites(tenant, body.name, body.sites, scope);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: /^no secret /.test(message) ? 404 : 400 });
    }
    await audit("secret.sites", { actor: actor.name, tenant, subject: body.name, detail: { name: body.name, sites, ...(scope ? { workspace: scope } : {}) } });
    return NextResponse.json({ ok: true, name: body.name, scope: scope ? "workspace" : "account", sites });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function PUT(...args: Parameters<typeof putOnce>) {
  return idempotent(args[0], () => putOnce(...args));
}
