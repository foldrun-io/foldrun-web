"use client";

// Connections: how agents reach external tools. One form. Pick a type, fill
// the fields that type needs — no presets, no wizard; the users are
// programmers and know what a token URL is. Every connection is a vault
// secret under the hood; the type only decides which fields to ask for and
// how the value is used at run time.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, buttonClass, inputClass, selectClass, Card, SectionHeading, FIELD_LABEL_CLASS } from "@/components/ui";
import { useConfirm } from "@/components/confirm";

type Kind = "key" | "api" | "ssh" | "oauth" | "oauth_m2m" | "service_account" | "file" | "client_cert" | "identity";

const KIND_LABEL: Record<string, string> = {
  key: "API key",
  api: "API · headers",
  ssh: "SSH",
  "client-cert": "Client certificate",
  identity: "Identity · keyless",
  oauth2: "OAuth · auto-refresh",
  "service-account": "Service account",
  file: "File",
};

export interface ConnectionRow {
  name: string;
  updatedAt: string;
  scope: "account" | "workspace";
  shadowed?: boolean;
  kind?: "oauth2" | "service-account" | "file" | "ssh" | "api" | "client-cert" | "identity";
  /** The sites it is bound to: the egress proxy fills it for these alone,
   *  and it never enters a sandbox. Absent when unbound. */
  sites?: string[];
  /** What the far end said the last time this credential was used. Null
   *  when nothing has used it yet, which is a third state and shown as
   *  one: unused is not the same as working, or as broken. */
  health?: {
    last: { at: string; host: string; status: number | null; outcome: "accepted" | "refused" | "error" };
    refusals: number;
    lastAccepted: string | null;
  } | null;
}
/** A saved OAuth app (never its secret): its default scopes prefill a new
 *  connection's, which may ask for others. */
export interface SavedClientRow { name: string; scopes?: string }
/** An oauth2 secret's grant: which client reconnects it and whether it still works. */
export interface OAuthConnectionRow {
  name: string;
  workspace?: string;
  client: string | null;
  status: "ok" | "expiring" | "expired" | "failed" | "no-client";
  daysLeft: number | null;
  lastError?: string;
  lastErrorAt?: string;
  connectedAt?: string;
}

function GrantStatus({ c }: { c: OAuthConnectionRow }) {
  if (c.status === "failed") {
    return <p className="mt-0.5 text-xs text-red-600">refresh failed {c.lastErrorAt?.slice(0, 10)} — {c.lastError} · reconnect to fix</p>;
  }
  if (c.status === "expired") return <p className="mt-0.5 text-xs text-red-600">sign-in expired · reconnect to fix</p>;
  if (c.status === "expiring") return <p className="mt-0.5 text-xs text-amber-600">sign-in expires in {c.daysLeft} days</p>;
  if (c.status === "no-client") return <p className="mt-0.5 text-xs text-fg-subtle">connected {c.connectedAt?.slice(0, 10)} · no saved client, so no one-click reconnect</p>;
  return (
    <p className="mt-0.5 text-xs text-emerald-700">
      sign-in OK{c.daysLeft !== null ? ` · ${c.daysLeft} days left` : ""}{c.connectedAt ? ` · connected ${c.connectedAt.slice(0, 10)}` : ""}
    </p>
  );
}

/**
 * Whether the far end still accepts this credential.
 *
 * Three states, deliberately distinct. Accepted, refused, and never used —
 * because a vault that shows a green tick beside a key nothing has ever
 * tried is telling a comfortable lie, and the whole reason this exists is
 * that a dead key and an untouched key looked identical.
 *
 * A refusal carries the date it last worked, which is the sentence that
 * dates the breakage and usually names the cause without further digging.
 */
function SecretHealth({ health }: { health: ConnectionRow["health"] }) {
  if (!health) {
    return <p className="mt-0.5 text-xs text-fg-subtle">not used yet — nothing has tried this credential</p>;
  }
  const { last, refusals, lastAccepted } = health;
  const when = last.at.slice(0, 10);
  if (last.outcome === "refused") {
    return (
      <p className="mt-0.5 text-xs text-red-600">
        refused by {last.host} on {when}
        {last.status ? ` (${last.status})` : ""}
        {refusals > 1 ? ` · ${refusals} times running` : ""}
        {lastAccepted ? ` · last worked ${lastAccepted.slice(0, 10)}` : " · never seen working"}
      </p>
    );
  }
  if (last.outcome === "error") {
    return (
      <p className="mt-0.5 text-xs text-amber-600">
        {last.host} failed on {when}
        {last.status ? ` (${last.status})` : ""} — its end, not the key
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-xs text-emerald-700">
      accepted by {last.host} on {when}
    </p>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className={FIELD_LABEL_CLASS}>{label}</span>
    {children}
  </label>
);

/** Sites a secret may be bound to: typed as a comma- or space-separated line. */
/** The App choice for entering a new app — not a valid app name, so it can never be one. */
const NEW_APP = "+new";

/** "name=value" lines → the authorize_extra map; a line without "=" is refused
 *  rather than dropped, so a typo never quietly loses a parameter. */
function parseAuthorizeExtra(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf("=");
    if (i < 1) throw new Error(`extra authorize parameters are name=value, one per line — "${line}" is not`);
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const parseSites = (text: string) => text.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

/**
 * Where a secret may be sent. Bound, the sandbox holds only `${NAME}` and
 * the egress proxy fills it for those sites — the way Anthropic's cloud
 * sandboxes attach a network secret. Unbound, a step with a script or Bash
 * gets the real value in its sandbox, as before.
 */
function SecretSites({ row, tenant, workspace, editable }: { row: ConnectionRow; tenant: string; workspace?: string; editable: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((row.sites ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A file, an ssh key or a header set is unpacked inside the sandbox:
  // there is no request for the proxy to fill.
  if (row.kind === "file" || row.kind === "ssh" || row.kind === "api") return null;
  const sites = row.sites ?? [];
  async function save(next: string[]) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/secrets", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ sites: next, name: row.name, workspace: row.scope === "workspace" ? workspace : undefined }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "could not save");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-1 text-xs">
      {!editing ? (
        <p className="flex flex-wrap items-center gap-1.5 text-fg-subtle">
          {sites.length ? (
            <>
              <span>Sent only to</span>
              {sites.map((x) => <code key={x} className="font-mono text-fg">{x}</code>)}
              <span>· never in a sandbox</span>
            </>
          ) : (
            <span>Not bound to sites — a step with a script or Bash gets the real value in its sandbox</span>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing(true)} className="text-accent underline-offset-2 hover:underline">
              {sites.length ? "Edit sites" : "Bind to sites"}
            </button>
          )}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(parseSites(text)); }} className="flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="api.example.com, *.example.org" autoFocus
            aria-label={`Sites ${row.name} may be sent to`} className={inputClass("w-72 font-mono text-xs")} />
          <button type="submit" disabled={busy} className={buttonClass("primary")}>Save</button>
          {sites.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void save([])} className={buttonClass("secondary")}>Unbind</button>
          )}
          <button type="button" onClick={() => { setEditing(false); setText(sites.join(", ")); }} className={buttonClass("minimal")}>Cancel</button>
        </form>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}

export function Connections({
  tenant, secrets, clients, workspace, heading = true, callbackUrl = null, connections = [],
}: {
  tenant: string;
  secrets: ConnectionRow[];
  clients: SavedClientRow[];
  /** OAuth grant health per oauth2 secret, from /api/oauth/connections' source. */
  connections?: OAuthConnectionRow[];
  workspace?: string;
  /** False when the host page titles the section itself. */
  heading?: boolean;
  /** The redirect URL the consent flow will actually use, when the server
   *  has one configured (FOLDRUN_OAUTH_CALLBACK_URL). Otherwise it is this
   *  page's own origin plus /api/oauth/callback, filled in on the client. */
  callbackUrl?: string | null;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("key");
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Nothing is chosen for the person: "" = no app picked yet, NEW_APP = enter
  // one, else a saved app's name (no client id or secret again). With no saved
  // app on an account page there is nothing to pick, so a new one is implied.
  const [app, setApp] = useState("");
  const savedApp = kind === "oauth" ? clients.find((c) => c.name === app) : undefined;
  const newApp = kind === "oauth" && !workspace && (app === NEW_APP || clients.length === 0);
  const [copied, setCopied] = useState(false);
  // Resolved after mount: the server does not know which address the browser
  // used, and the consent flow builds the redirect from exactly that.
  const [redirect, setRedirect] = useState<string>(callbackUrl ?? "");
  useEffect(() => {
    if (!callbackUrl) setRedirect(`${window.location.origin}/api/oauth/callback`);
  }, [callbackUrl]);
  // Any edit clears the last error: it was about what the form held then.
  const set = (k: string) => (e: { target: { value: string } }) => { setError(null); setF({ ...f, [k]: e.target.value }); };
  const copyRedirect = async () => {
    try { await navigator.clipboard.writeText(redirect); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  // Opened from a "needs reconnecting" email: that row is marked.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => { setWanted(new URLSearchParams(window.location.search).get("reconnect")); }, []);
  const grantOf = (row: ConnectionRow) =>
    connections.find((c) => c.name === row.name && (row.scope === "workspace" ? c.workspace === workspace : !c.workspace));

  async function reconnect(row: ConnectionRow) {
    setError(null);
    const res = await fetch("/api/oauth/reconnect", {
      method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ secret: row.name, workspace: row.scope === "workspace" ? workspace : undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && data.url) window.location.href = data.url;
    else setError(data.error ?? "could not start the reconnect");
  }

  const clientNameFor = (n: string) => n.toLowerCase().replaceAll("_", "-");
  const hasClient = (n: string) => clients.some((c) => c.name === clientNameFor(n));

  async function put(payload: object) {
    const res = await fetch("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ workspace, ...payload, name }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "could not save");
  }

  async function submit() {
    setError(null); setBusy(true);
    try {
      if (kind === "key") await put({ value: f.value ?? "", ...(f.sites?.trim() ? { sites: parseSites(f.sites) } : {}) });
      else if (kind === "file") await put({ file: f.file ?? "" });
      else if (kind === "ssh") {
        await put({ ssh: {
          host: f.host ?? "", user: f.user ?? "",
          ...(f.port ? { port: Number(f.port) } : {}),
          ...(f.auth === "password" ? { password: f.password ?? "" } : { private_key: f.key ?? "" }),
        }});
      } else if (kind === "api") {
        // "Name: value" lines → headers object; the first colon splits.
        const headers = Object.fromEntries(
          (f.headers ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            .map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
        );
        // Basic from a username and password: the platform builds the header.
        const basic = f.basic_user ? { basic: { username: f.basic_user, password: f.basic_password ?? "" } } : {};
        await put({ api: { ...(f.base_url ? { base_url: f.base_url } : {}), headers, ...basic } });
      }
      else if (kind === "identity") {
        await put({ identity: { audience: f.audience ?? "" } });
      }
      else if (kind === "client_cert") {
        await put({ client_cert: {
          cert: f.cert ?? "", key: f.cert_key ?? "",
          ...(f.passphrase ? { passphrase: f.passphrase } : {}),
          ...(f.cert_export === "yes" ? { export: true } : {}),
        }, ...(f.sites?.trim() ? { sites: parseSites(f.sites) } : {}) });
      }
      else if (kind === "service_account") {
        // Programmers have the JSON key from Google; parse it rather than
        // asking them to retype four fields out of it.
        const j = JSON.parse(f.json ?? "{}");
        // The key file names its own token endpoint; none is assumed.
        if (!j.token_uri) throw new Error("the key file has no token_uri — paste the whole file the provider gave you");
        await put({ service_account: {
          token_url: j.token_uri,
          issuer: j.client_email, private_key: j.private_key,
          scope: f.scope ?? "",
          ...(f.subject?.trim() ? { subject: f.subject.trim() } : {}),
        }});
      } else if (kind === "oauth_m2m") {
        await put({ oauth2: {
          token_url: f.token_url, client_id: f.client_id, client_secret: f.client_secret,
          grant_type: "client_credentials", ...(f.scope ? { extra: { scope: f.scope } } : {}),
        }});
      } else {
        // Browser OAuth from a saved app: only this connection's scopes,
        // asked for in so many words — an empty field would quietly mean the
        // app's default (Codex review).
        if (savedApp) {
          if (!f.scope?.trim()) throw new Error("type the scopes this connection needs, as the provider spells them");
          return connect(name, savedApp.name, f.scope);
        }
        if (!newApp) throw new Error("choose an app — a saved one, or a new one");
        const authorize_extra = parseAuthorizeExtra(f.authorize_extra ?? "");
        // Browser OAuth: save the client, then straight into consent.
        const saved = await fetch("/api/oauth/clients", {
          method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify({ config: {
            authorize_url: f.authorize_url, token_url: f.token_url,
            client_id: f.client_id, client_secret: f.client_secret ?? "", scopes: f.scope ?? "",
            ...(Object.keys(authorize_extra).length ? { authorize_extra } : {}),
            ...(f.pkce === "off" ? { pkce: false } : {}),
            ...(f.issuer?.trim() ? { issuer: f.issuer.trim() } : {}),
          }, name: clientNameFor(name) }),
        });
        if (!saved.ok) throw new Error(((await saved.json().catch(() => ({}))) as { error?: string }).error ?? "could not save the client");
        return connect(name);
      }
      setName(""); setF({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function connect(secretName: string, client = clientNameFor(secretName), scopes?: string) {
    const res = await fetch("/api/oauth/start", {
      method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ client, secret: secretName, workspace, ...(scopes?.trim() ? { scopes } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && data.url) window.location.href = data.url;
    else setError(data.error ?? "could not start the flow");
  }

  async function remove(row: ConnectionRow) {
    const where = row.scope === "account" ? "every workspace in this account" : workspace;
    if (
      !(await confirm({
        title: `Delete ${row.name}?`,
        body: `It is removed from ${where}. Agents using it fail until it's replaced.`,
        confirmLabel: "Delete",
      }))
    )
      return;
    await fetch("/api/secrets", {
      method: "DELETE", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ workspace: row.scope === "account" ? undefined : workspace, name: row.name }),
    });
    // The app saved under this secret's name goes with it only when it is
    // this connection's alone: other connections may share it (a saved app
    // serves any number of them), and a workspace page never deletes an
    // account-wide app.
    const app = clientNameFor(row.name);
    const sharedBy = connections.filter((c) => c.client === app && !(c.name === row.name && (c.workspace ?? undefined) === (row.scope === "workspace" ? workspace : undefined)));
    if (!workspace && hasClient(row.name) && sharedBy.length === 0) {
      await fetch("/api/oauth/clients", {
        method: "DELETE", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ client: clientNameFor(row.name) }),
      });
    }
    router.refresh();
  }

  const cred = "font-mono";
  const oauthBrowser = kind === "oauth";

  return (
    <section className={heading ? "mb-8" : ""}>
      {confirmDialog}
      {heading && <SectionHeading>Connections</SectionHeading>}
      <Card className="mb-3 p-4">
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3" autoComplete="off">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Name">
              <input value={name} autoComplete="off"
                onChange={(e) => { setError(null); setName(e.target.value.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")); }}
                placeholder="CRM_TOKEN" className={inputClass("w-56 font-mono")} />
            </Field>
            <Field label="Type">
              <select
                value={kind}
                onChange={(e) => {
                  setError(null);
                  setKind(e.target.value as Kind);
                  setApp("");
                  setF({});
                }}
                className={selectClass()}
              >
                <option value="key">API key / token</option>
                <option value="api">API — base URL + headers</option>
                <option value="ssh">SSH</option>
                <option value="client_cert">Client certificate (mutual TLS)</option>
                <option value="identity">Identity — keyless cloud access</option>
                {/* Browser OAuth needs a saved app, which is account-scoped (an
                    app belongs to the account): a workspace connects through one
                    the account saved, and saves none itself. The other two are
                    self-contained secrets and work at either scope. */}
                {(!workspace || clients.length > 0) && <option value="oauth">OAuth — browser sign-in</option>}
                <option value="oauth_m2m">OAuth — client credentials</option>
                <option value="service_account">Service account (JSON key)</option>
                <option value="file">File (SSH key, certificate)</option>
              </select>
            </Field>
            <button type="submit" disabled={busy || !name || (oauthBrowser && !savedApp && !newApp)} className={buttonClass("primary")}>
              {oauthBrowser ? (savedApp ? "Connect →" : "Save & Connect →") : "Save"}
            </button>
          </div>

          {kind === "key" && (
            <>
              <Field label="Value (write-only)">
                <input type="password" value={f.value ?? ""} onChange={set("value")} autoComplete="new-password" className={inputClass(cred)} />
              </Field>
              <Field label="Sites (optional)">
                <input value={f.sites ?? ""} onChange={set("sites")} placeholder="api.example.com, *.example.org" autoComplete="off" className={inputClass(`w-72 ${cred}`)} />
              </Field>
              <p className="text-xs text-fg-muted">
                Bound to sites, the value never enters a sandbox: scripts and Bash hold <code className="font-mono">{`\${${name || "NAME"}}`}</code> and
                the egress proxy fills it in requests to those sites, and no other.
              </p>
            </>
          )}

          {kind === "ssh" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Field label="Host"><input value={f.host ?? ""} onChange={set("host")} placeholder="10.0.4.20" className={inputClass(`w-56 ${cred}`)} autoComplete="off" /></Field>
                <Field label="Port"><input value={f.port ?? ""} onChange={set("port")} placeholder="22" className={inputClass(`w-20 ${cred}`)} autoComplete="off" /></Field>
                <Field label="Username"><input value={f.user ?? ""} onChange={set("user")} placeholder="deploy" className={inputClass(`w-40 ${cred}`)} autoComplete="off" /></Field>
                <Field label="Auth">
                  <select value={f.auth ?? "key"} onChange={set("auth")} className={selectClass()}>
                    <option value="key">Private key</option>
                    <option value="password">Password</option>
                  </select>
                </Field>
              </div>
              {(f.auth ?? "key") === "key" ? (
                <Field label="Private key">
                  <textarea value={f.key ?? ""} onChange={set("key")} rows={4}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className={inputClass(cred)} />
                </Field>
              ) : (
                <Field label="Password">
                  <input type="password" value={f.password ?? ""} onChange={set("password")} autoComplete="new-password" className={inputClass(cred)} />
                </Field>
              )}
              <p className="text-xs text-fg-muted">
                The agent gets a ready-to-run command: <code className="font-mono">{`"$${name || "NAME"}" 'uptime'`}</code> — key or password, same usage.
              </p>
            </>
          )}

          {kind === "api" && (
            <>
              <Field label="Base URL (optional)">
                <input value={f.base_url ?? ""} onChange={set("base_url")} placeholder="https://api.stripe.com" className={inputClass(cred)} autoComplete="off" />
              </Field>
              <Field label="Headers — one per line, Name: value">
                <textarea value={f.headers ?? ""} onChange={set("headers")} rows={3}
                  placeholder={"Authorization: Bearer sk_live_…\nStripe-Version: 2026-01-28"} className={inputClass(cred)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Field label="Basic username (optional)">
                  <input value={f.basic_user ?? ""} onChange={set("basic_user")} className={inputClass(cred)} autoComplete="off" />
                </Field>
                <Field label="Basic password">
                  <input type="password" value={f.basic_password ?? ""} onChange={set("basic_password")} className={inputClass(cred)} autoComplete="new-password" />
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                The agent gets a curl with the headers baked in: <code className="font-mono">{`"$${name || "NAME"}" /v1/charges`}</code> — the secret never appears in the command.
              </p>
            </>
          )}

          {kind === "file" && (
            <Field label="File contents — written to a 0600 path at run time; the env var holds the path">
              <textarea value={f.file ?? ""} onChange={set("file")} rows={4}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className={inputClass(cred)} />
            </Field>
          )}

          {kind === "identity" && <IdentityFields tenant={tenant} workspace={workspace} audience={f.audience ?? ""} onAudience={set("audience")} />}

          {kind === "client_cert" && (
            <>
              <Field label="Certificate (PEM, chain included)">
                <textarea value={f.cert ?? ""} onChange={set("cert")} rows={3} placeholder="-----BEGIN CERTIFICATE-----" className={inputClass(cred)} />
              </Field>
              <Field label="Private key (PEM)">
                <textarea value={f.cert_key ?? ""} onChange={set("cert_key")} rows={3} placeholder="-----BEGIN PRIVATE KEY-----" className={inputClass(cred)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Field label="Passphrase (if the key has one)">
                  <input type="password" value={f.passphrase ?? ""} onChange={set("passphrase")} className={inputClass(cred)} autoComplete="new-password" />
                </Field>
                <Field label="Sites it is presented to (exact hosts)">
                  <input value={f.sites ?? ""} onChange={set("sites")} placeholder="api.bank.example" className={inputClass(`w-72 ${cred}`)} autoComplete="off" />
                </Field>
                <Field label="In the sandbox">
                  <select value={f.cert_export ?? "no"} onChange={set("cert_export")} className={selectClass("w-64")}>
                    <option value="no">never — the egress proxy presents it</option>
                    <option value="yes">as files too (a step with no proxy)</option>
                  </select>
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                The egress proxy presents it on its own connection to the sites named — the key never enters the sandbox unless you choose files.
              </p>
            </>
          )}

          {kind === "service_account" && (
            <>
              <Field label="Service account JSON key (paste the whole file)">
                {/* The placeholder shows the SHAPE of a key so a person knows what
                    to paste; the scanner sees the shape too. It is a prompt with
                    ellipses in it, not a credential. */}
                <textarea value={f.json ?? ""} onChange={set("json")} rows={4}
                  placeholder='{ "type": "service_account", "client_email": "…", "private_key": "…" }' className={inputClass(cred)} /> {/* nosemgrep: generic.secrets.security.detected-google-gcm-service-account.detected-google-gcm-service-account */}
              </Field>
              <Field label="Scopes (space-separated)">
                <input value={f.scope ?? ""} onChange={set("scope")} placeholder="the scopes the provider documents" className={inputClass(cred)} />
              </Field>
              <Field label="Act as (optional) — the user it works as, where the provider allows it">
                <input value={f.subject ?? ""} onChange={set("subject")} placeholder="ana@example.com" className={inputClass(cred)} autoComplete="off" />
              </Field>
            </>
          )}

          {(kind === "oauth" || kind === "oauth_m2m") && (
            <div className="grid grid-cols-2 gap-2">
              {kind === "oauth" && clients.length > 0 && (
                <Field label="App">
                  <select
                    value={app}
                    // Scopes are not carried over from the app: each connection
                    // asks for its own, typed for what it is for.
                    onChange={(e) => { setError(null); setApp(e.target.value); setF({ ...f, scope: "" }); }}
                    className={selectClass("w-72")}
                  >
                    <option value="" disabled>Choose an app…</option>
                    {!workspace && <option value={NEW_APP}>A new app — enter its client id and secret</option>}
                    {clients.map((c) => <option key={c.name} value={c.name}>{c.name} (saved)</option>)}
                  </select>
                </Field>
              )}
              {savedApp && (
                <p className="col-span-2 text-xs text-fg-muted">
                  Connects with the saved app <code className="font-mono">{savedApp.name}</code>. Ask for the scopes this
                  connection needs, as the provider spells them; they stay with this connection, so Reconnect asks for the
                  same ones. The provider must allow them for the app.
                </p>
              )}
              {newApp && (
                // First, because it is the step people do somewhere else: the
                // provider's console refuses a redirect it has not seen, and
                // the address is whichever one this page was opened at.
                <div className="col-span-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="font-medium">1. Register this redirect URL on your app, then connect.</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="font-mono break-all">{redirect || "…/api/oauth/callback"}</code>
                    <button type="button" onClick={copyRedirect} className={buttonClass("secondary")}>{copied ? "Copied" : "Copy"}</button>
                  </div>
                  <div className="mt-1 text-amber-800">
                    It is the address you opened this dashboard at. Most providers accept https, or http on localhost only,
                    so open the dashboard from an address the provider allows before you click Save &amp; Connect.
                  </div>
                </div>
              )}
              {newApp && (
                <Field label="Authorize URL"><input value={f.authorize_url ?? ""} onChange={set("authorize_url")} placeholder="https://auth.example.com/authorize" className={inputClass(cred)} autoComplete="off" /></Field>
              )}
              {(kind === "oauth_m2m" || newApp) && <>
              <Field label="Token URL"><input value={f.token_url ?? ""} onChange={set("token_url")} placeholder="https://auth.example.com/token" className={inputClass(cred)} autoComplete="off" /></Field>
              <Field label="client_id"><input value={f.client_id ?? ""} onChange={set("client_id")} className={inputClass(cred)} autoComplete="off" /></Field>
              <Field label={kind === "oauth" ? "client_secret (empty for a public app)" : "client_secret"}><input type="password" value={f.client_secret ?? ""} onChange={set("client_secret")} className={inputClass(cred)} autoComplete="new-password" /></Field>
              {kind === "oauth" && (
                <Field label="PKCE">
                  <select value={f.pkce ?? "on"} onChange={set("pkce")} className={selectClass("w-56")}>
                    <option value="on">on (recommended)</option>
                    <option value="off">off — only if the provider refuses it</option>
                  </select>
                </Field>
              )}
              {kind === "oauth" && (
                <Field label="Issuer (optional — when the provider sends iss)"><input value={f.issuer ?? ""} onChange={set("issuer")} placeholder="https://auth.example.com" className={inputClass(cred)} autoComplete="off" /></Field>
              )}
              {kind === "oauth" && (
                <div className="col-span-2">
                  <Field label="Extra authorize parameters (optional) — one name=value per line, as the provider documents">
                    <textarea value={f.authorize_extra ?? ""} onChange={set("authorize_extra")} rows={2} placeholder="name=value" className={inputClass(cred)} />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">
                    Whatever else the provider&apos;s authorize URL takes. Some issue a refresh token only when asked here
                    (Google: <code className="font-mono">access_type=offline</code> and <code className="font-mono">prompt=consent</code>);
                    without one the connection stops when the first access token expires.
                  </p>
                </div>
              )}
              </>}
              {(kind === "oauth_m2m" || savedApp || newApp) && (
                <Field label="Scopes (space-separated)"><input value={f.scope ?? ""} onChange={set("scope")} className={inputClass(cred)} autoComplete="off" /></Field>
              )}
            </div>
          )}
        </form>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </Card>

      <Card>
        {secrets.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-muted">No connections yet.</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {secrets.map((s) => { const grant = grantOf(s); /* any kind: a plain token from an OAuth consent has a connection too */ return (
              <li key={`${s.scope}:${s.name}`} className={`flex flex-wrap items-center gap-3 px-5 py-3${wanted === s.name ? " bg-amber-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-mono text-sm font-medium text-fg">
                    {s.name}
                    <Badge variant={s.kind === "oauth2" ? "info" : "default"}>{KIND_LABEL[s.kind ?? "key"]}</Badge>
                    {workspace && s.scope === "account" && <Badge>inherited</Badge>}
                    {s.shadowed && <Badge variant="warning">overrides account</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-subtle">•••••••• · updated {s.updatedAt.slice(0, 10)}</p>
                  {grant && <GrantStatus c={grant} />}
                  <SecretHealth health={s.health ?? null} />
                  <SecretSites row={s} tenant={tenant} workspace={workspace} editable={!workspace || s.scope === "workspace"} />
                </div>
                {grant?.client && (!workspace || s.scope === "workspace") ? (
                  <button onClick={() => reconnect(s)} className={buttonClass(grant.status === "ok" ? "secondary" : "primary")}>Reconnect</button>
                ) : !workspace && hasClient(s.name) && (
                  <button onClick={() => connect(s.name)} className={buttonClass("secondary")}>Reconnect</button>
                )}
                {(!workspace || s.scope === "workspace") && (
                  <button onClick={() => remove(s)} className={buttonClass("destructive")}>Delete</button>
                )}
              </li>
            ); })}
          </ul>
        )}
      </Card>
      <p className="mt-2 text-xs text-fg-muted">
        An agent declares <code className="font-mono">secrets:</code> to receive a connection as an
        environment variable, or references it in <code className="font-mono">apis:</code> headers as{" "}
        <code className="font-mono">{"${NAME}"}</code>. The model never sees the value. Bind a connection to the sites it is
        for and the value stays out of every sandbox too — the egress proxy fills it on the way out.
      </p>
    </section>
  );
}

/** Keyless cloud identity: the audience to ask for, and what the cloud's
 *  trust policy must name — this install's issuer and the agent's subject. */
function IdentityFields({ tenant, workspace, audience, onAudience }: { tenant: string; workspace?: string; audience: string; onAudience: (e: { target: { value: string } }) => void }) {
  const [info, setInfo] = useState<{ enabled: boolean; issuer: string | null; subject: string } | null>(null);
  useEffect(() => {
    void fetch(`/api/identity${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`, { headers: { "x-foldrun-tenant": tenant } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [tenant, workspace]);
  return (
    <>
      <Field label="Audience — the value your cloud's trust expects in aud">
        <input value={audience} onChange={onAudience} placeholder="sts.amazonaws.com" className={inputClass("w-96 font-mono")} autoComplete="off" />
      </Field>
      {info && !info.enabled ? (
        <p className="text-xs text-red-600">This install does not issue identity tokens yet (its operator sets FOLDRUN_OIDC_ISSUER).</p>
      ) : info ? (
        <div className="text-xs text-fg-muted">
          <p>Trust this issuer in your cloud: <code className="font-mono text-fg">{info.issuer}</code></p>
          <p className="mt-1">Each agent&apos;s tokens carry the subject <code className="font-mono text-fg">{info.subject}</code> — pin at least the account in the trust policy.</p>
          <p className="mt-1">A step that declares it gets <code className="font-mono">$NAME_FILE</code>: a token lasting ten minutes, renewed while the step runs. Nothing is stored here but the audience.</p>
        </div>
      ) : null}
    </>
  );
}
