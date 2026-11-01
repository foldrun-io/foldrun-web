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

type Kind = "key" | "api" | "ssh" | "oauth" | "oauth_m2m" | "service_account" | "file" | "client_cert" | "identity" | "token_exchange";

const KIND_LABEL: Record<string, string> = {
  key: "API key",
  api: "API · headers",
  ssh: "SSH",
  "client-cert": "Client certificate",
  identity: "Identity · keyless",
  "token-exchange": "OAuth · token exchange",
  oauth2: "OAuth · auto-refresh",
  "service-account": "Service account",
  file: "File",
};

export interface ConnectionRow {
  name: string;
  updatedAt: string;
  scope: "account" | "workspace";
  shadowed?: boolean;
  kind?: "oauth2" | "service-account" | "file" | "ssh" | "api" | "client-cert" | "identity" | "token-exchange";
  /** The sites it is bound to: the egress proxy fills it for these alone,
   *  and it never enters a sandbox. Absent when unbound. */
  sites?: string[];
  /** An account secret limited to these workspaces; absent: every one. */
  workspaces?: string[];
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
export interface SavedClientRow { name: string; scopes?: string; /** RFC 8628: the app can connect with a code. */ device_url?: string }
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

/**
 * Which workspaces may use an account secret: all (the default), or only
 * the ones selected — GitHub's "selected repositories" for an organisation
 * secret. Any other workspace finds it not set. `choices` is every
 * workspace's name when the viewer may change it (an account-wide admin);
 * without it the setting is shown, not offered.
 */
function SecretWorkspaces({ row, tenant, choices }: { row: ConnectionRow; tenant: string; choices?: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"all" | "selected">(row.workspaces ? "selected" : "all");
  const [picked, setPicked] = useState<string[]>(row.workspaces ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/secrets", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        // ifWorkspaces: the list this row showed. Another admin's change
        // since is refused (409) rather than silently overwritten.
        body: JSON.stringify({ workspaces: mode === "all" ? null : picked, ifWorkspaces: row.workspaces ?? null, name: row.name }),
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
  const limited = row.workspaces;
  return (
    <div className="mt-1 text-xs">
      {!editing ? (
        <p className="flex flex-wrap items-center gap-1.5 text-fg-subtle">
          <span>Workspaces:</span>
          {!limited ? (
            <span className="text-fg">all</span>
          ) : limited.length ? (
            <>
              <span>only</span>
              {limited.map((w) => <code key={w} className="font-mono text-fg">{w}</code>)}
            </>
          ) : (
            <span className="text-fg">none — no workspace can use it</span>
          )}
          {choices && (
            <button type="button" onClick={() => {
              // From what the page holds NOW, not what it held when this row
              // first drew: a refresh since may have changed the list.
              setMode(row.workspaces ? "selected" : "all");
              setPicked(row.workspaces ?? []);
              setError(null);
              setEditing(true);
            }} className="text-accent underline-offset-2 hover:underline">
              Change
            </button>
          )}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={`Workspaces that may use ${row.name}`}>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`ws-${row.name}`} checked={mode === "all"} onChange={() => setMode("all")} />
              All workspaces
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`ws-${row.name}`} checked={mode === "selected"} onChange={() => setMode("selected")} />
              Selected workspaces
            </label>
          </div>
          {mode === "selected" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(choices ?? []).map((w) => (
                <label key={w} className="flex items-center gap-1.5 font-mono">
                  <input type="checkbox" checked={picked.includes(w)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, w] : picked.filter((x) => x !== w))} />
                  {w}
                </label>
              ))}
            </div>
          )}
          <p className="text-fg-muted">
            &quot;All&quot; includes workspaces made later. A change applies to runs that start after it — stop a running one to cut it off now.
          </p>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={buttonClass("primary")}>Save</button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass("minimal")}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}

export function Connections({
  tenant, secrets, clients, workspace, heading = true, callbackUrl = null, connections = [], limitTo,
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
  /** Every workspace's name, on the account's page for a viewer who may
   *  limit an account secret to some of them; otherwise the limit is shown
   *  and not offered. */
  limitTo?: string[];
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("key");
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // What revoking a deleted connection at its provider came to.
  const [notice, setNotice] = useState<string | null>(null);
  // A signing key foldrun made (private_key_jwt): its public JWK, to register
  // with the provider before consent — and the connection that waits for it.
  const [jwk, setJwk] = useState<{ key: string; connect?: string } | null>(null);
  // A device-code connection in progress (RFC 8628): the code to type and where.
  const [device, setDevice] = useState<{ id: string; user_code: string; verification_uri: string; verification_uri_complete?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A new account secret's workspaces: null is all (the default), a list is
  // only those — sent with the value in the same PUT, so it is never open
  // to every workspace in between (30 Oct 2026).
  const [newLimit, setNewLimit] = useState<string[] | null>(null);
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
  const set = (k: string) => (e: { target: { value: string } }) => {
    setError(null);
    // A new issuer: what the old one's metadata said (PAR, revocation, the
    // iss rule) no longer applies — Discover again to fill it.
    const stale: Record<string, string> = k === "issuer" ? { revocation_url: "", device_url: "", par_url: "", iss_parameter: "", discovered_secret: "" } : {};
    setF((cur) => ({ ...cur, ...stale, [k]: e.target.value }));
  };
  // Discovery (POST /api/oauth/discover): the provider's own metadata fills
  // the URLs and how the app signs in at the token URL; what it found about
  // revocation, device sign-in and PAR is kept for the save.
  const [discovering, setDiscovering] = useState(false);
  type Discovered = { authorize_url?: string; token_url: string; token_auth?: string; revocation_url?: string; device_url?: string; par_url?: string; iss_parameter?: boolean };
  const fetchDiscovery = async (issuer: string, hasSecret: boolean): Promise<Discovered> => {
    const res = await fetch("/api/oauth/discover", {
      method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ issuer, has_secret: hasSecret, ...(f.pkce === "off" ? { pkce: false } : {}) }),
    });
    const j = (await res.json().catch(() => ({}))) as { config?: Discovered; error?: string };
    if (!res.ok || !j.config) throw new Error(j.error ?? "discovery failed");
    return j.config;
  };
  const discover = async () => {
    setError(null);
    setDiscovering(true);
    const asked = (f.issuer ?? "").trim();
    // Asked as the app is now — with a secret or a public one; Save asks
    // again if that changes after (the token URL's sign-in depends on it).
    const withSecret = !!f.client_secret?.trim();
    try {
      const c = await fetchDiscovery(asked, withSecret);
      // Merged into the form as it is now, not as it was when Discover was
      // pressed — and dropped if the issuer was changed meanwhile.
      setF((cur) => (cur.issuer ?? "").trim() !== asked ? cur : {
        ...cur,
        ...(c.authorize_url ? { authorize_url: c.authorize_url } : {}),
        token_url: c.token_url,
        token_auth: c.token_auth === "client_secret_basic" ? "client_secret_basic" : "client_secret_post",
        revocation_url: c.revocation_url ?? "", device_url: c.device_url ?? "", par_url: c.par_url ?? "",
        iss_parameter: String(c.iss_parameter === true),
        discovered_secret: withSecret ? "1" : "0",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  };
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

  async function put(payload: object): Promise<{ public_jwk?: Record<string, unknown> }> {
    const res = await fetch("/api/secrets", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ workspace, ...payload, name, ...(!workspace && limitTo && newLimit !== null ? { workspaces: newLimit } : {}) }),
    });
    const answer = (await res.json().catch(() => ({}))) as { error?: string; public_jwk?: Record<string, unknown> };
    if (!res.ok) throw new Error(answer.error ?? "could not save");
    return answer;
  }
  /** private_key_jwt: the key pasted (and its certificate), or a new one made. */
  const signedJwt = () => f.token_auth === "private_key_jwt";
  /** tls_client_auth: the certificate and key pasted (RFC 8705). */
  const certAuth = () => f.token_auth === "tls_client_auth";
  const certFields = () => ({ tls_client_cert: (f.tls_client_cert ?? "").trim(), tls_client_key: (f.tls_client_key ?? "").trim() });
  const keyFields = () => f.client_assertion_key?.trim()
    ? { client_assertion_key: f.client_assertion_key.trim(), ...(f.client_assertion_cert?.trim() ? { client_assertion_cert: f.client_assertion_cert.trim() } : {}) }
    : { generate_key: true };

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
      else if (kind === "token_exchange") {
        // RFC 8693: another secret's token traded for a narrower one.
        await put({ token_exchange: {
          token_url: f.token_url ?? "", client_id: f.client_id ?? "",
          ...(f.client_secret ? { client_secret: f.client_secret } : {}),
          ...(f.token_auth === "client_secret_basic" ? { token_auth: "client_secret_basic" } : {}),
          subject_secret: (f.subject_secret ?? "").trim(),
          ...(f.audience?.trim() ? { audience: f.audience.trim() } : {}),
          ...(f.scope?.trim() ? { scope: f.scope.trim() } : {}),
          ...(f.requested_token_type?.trim() ? { requested_token_type: f.requested_token_type.trim() } : {}),
        } });
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
        const answer = await put({ oauth2: {
          token_url: f.token_url, client_id: f.client_id, ...(signedJwt() ? keyFields() : certAuth() ? certFields() : { client_secret: f.client_secret }),
          grant_type: "client_credentials", ...(f.scope ? { extra: { scope: f.scope } } : {}),
          ...(f.token_auth === "client_secret_basic" || signedJwt() || certAuth() ? { token_auth: f.token_auth } : {}),
          ...(f.dpop === "on" ? { dpop: true } : {}),
        }});
        if (signedJwt() && !f.client_assertion_key?.trim() && answer.public_jwk) setJwk({ key: JSON.stringify(answer.public_jwk, null, 2) });
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
        // Discovered before the secret was entered (or cleared after): ask
        // again, so the app signs in at the token URL the way the server
        // takes for an app like this one.
        let tokenAuth = f.token_auth;
        const hasSecret = !!f.client_secret?.trim();
        if (!signedJwt() && !certAuth() && f.discovered_secret && f.issuer?.trim() && f.discovered_secret !== (hasSecret ? "1" : "0")) {
          tokenAuth = (await fetchDiscovery(f.issuer.trim(), hasSecret)).token_auth ?? "client_secret_post";
        }
        // Browser OAuth: save the client, then straight into consent.
        const saved = await fetch("/api/oauth/clients", {
          method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify({ config: {
            authorize_url: f.authorize_url, token_url: f.token_url,
            client_id: f.client_id, client_secret: signedJwt() || certAuth() ? "" : f.client_secret ?? "", scopes: f.scope ?? "",
            ...(signedJwt() ? { token_auth: "private_key_jwt", ...keyFields() } : {}),
            ...(certAuth() ? { token_auth: "tls_client_auth", ...certFields() } : {}),
            ...(f.dpop === "on" ? { dpop: true } : {}),
            ...(Object.keys(authorize_extra).length ? { authorize_extra } : {}),
            ...(f.pkce === "off" ? { pkce: false } : {}),
            ...(f.issuer?.trim() ? { issuer: f.issuer.trim() } : {}),
            // Found by Discover: the server's own facts, kept with the app.
            ...(f.iss_parameter ? { iss_parameter: f.iss_parameter === "true" } : {}),
            ...(f.revocation_url ? { revocation_url: f.revocation_url } : {}),
            ...(f.device_url ? { device_url: f.device_url } : {}),
            ...(f.par_url ? { par_url: f.par_url } : {}),
            // Absent is the form body (or none, for a public app). A public
            // app sends no secret whatever was discovered.
            ...(!signedJwt() && !certAuth() && tokenAuth === "client_secret_basic" && hasSecret ? { token_auth: "client_secret_basic" } : {}),
          }, name: clientNameFor(name) }),
        });
        const answer = (await saved.json().catch(() => ({}))) as { error?: string; public_jwk?: Record<string, unknown> };
        if (!saved.ok) throw new Error(answer.error ?? "could not save the client");
        // A key foldrun just made: the provider must know its public half
        // before any consent can be signed for — shown, and Connect waits.
        if (signedJwt() && !f.client_assertion_key?.trim() && answer.public_jwk) {
          setJwk({ key: JSON.stringify(answer.public_jwk, null, 2), connect: name });
          return;
        }
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

  /** Connect a saved app with a code instead of a redirect, polling until
   *  the grant is stored (POST /api/oauth/device, then …/device/<id>). */
  async function connectWithCode() {
    if (!savedApp) return;
    if (!f.scope?.trim()) { setError("type the scopes this connection needs, as the provider spells them"); return; }
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/oauth/device", {
        method: "POST", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ client: savedApp.name, secret: name, workspace, scopes: f.scope }),
      });
      const started = (await res.json().catch(() => ({}))) as { id?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; interval?: number; error?: string };
      if (!res.ok || !started.id) throw new Error(started.error ?? "could not start");
      setDevice({ id: started.id, user_code: started.user_code!, verification_uri: started.verification_uri!, ...(started.verification_uri_complete ? { verification_uri_complete: started.verification_uri_complete } : {}) });
      let interval = started.interval ?? 5;
      const deadline = Date.now() + ((started as { expires_in?: number }).expires_in ?? 600) * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (Date.now() > deadline) throw new Error("the code ran out before anyone approved it — try again");
        // A dropped connection or a server hiccup is retried, less often; only
        // the platform's own answer stops the wait (Codex review).
        let p: Response;
        try {
          p = await fetch(`/api/oauth/device/${started.id}`, { method: "POST", headers: { "x-foldrun-tenant": tenant } });
        } catch {
          interval = interval >= 60 ? interval : Math.min(interval * 2, 60);
          continue;
        }
        if (p.status >= 500) { interval = interval >= 60 ? interval : Math.min(interval * 2, 60); continue; }
        const r = (await p.json().catch(() => ({}))) as { status?: string; reason?: string; error?: string; retry?: boolean };
        if (!p.ok) throw new Error(r.error ?? "the connection stopped");
        // The provider timed out on the platform's side: poll less often too.
        if (r.retry) { interval = interval >= 60 ? interval : Math.min(interval * 2, 60); continue; }
        if (r.status === "slow_down") interval += 5;
        else if (r.status === "connected") break;
        else if (r.status === "denied" || r.status === "expired") throw new Error(r.reason ?? r.status);
      }
      setDevice(null); setName(""); setF({});
      router.refresh();
    } catch (err) {
      setDevice(null);
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
        body: `It is removed from ${where}. Agents using it fail until it's replaced.${row.kind === "oauth2" ? " Its grant is also revoked at the provider, when the app has a revocation URL." : ""}`,
        confirmLabel: "Delete",
      }))
    )
      return;
    setNotice(null);
    const res = await fetch("/api/secrets", {
      method: "DELETE", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ workspace: row.scope === "account" ? undefined : workspace, name: row.name }),
    });
    // Revoked after the delete (RFC 7009): a failure is said, not hidden —
    // the grant may still be live at the provider until revoked there.
    const r = ((await res.json().catch(() => ({}))) as { revoked?: { skipped?: string; revoked: string[]; error?: string } }).revoked;
    if (r?.error) setNotice(`${row.name} is deleted, but ${r.error}. Revoke the app's access in the provider's own settings.`);
    else if (r?.revoked.length) setNotice(`${row.name} is deleted and its grant revoked at the provider.`);
    else if (r?.skipped === "shared-grant") setNotice(`${row.name} is deleted; its grant was not revoked: another connection uses the same app, and the provider may revoke them together.`);
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
                <option value="token_exchange">OAuth — token exchange</option>
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
            {savedApp?.device_url && (
              <button type="button" disabled={busy || !name} onClick={() => void connectWithCode()} className={buttonClass("secondary")}>Connect with a code</button>
            )}
          </div>

          {!workspace && limitTo && !oauthBrowser && (
            <div className="space-y-1 text-xs" role="radiogroup" aria-label="Workspaces that may use it">
              <div className="flex flex-wrap items-center gap-3">
                <span className={FIELD_LABEL_CLASS}>Workspaces</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="new-secret-workspaces" checked={newLimit === null} onChange={() => setNewLimit(null)} />
                  All workspaces
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="new-secret-workspaces" checked={newLimit !== null} onChange={() => setNewLimit([])} />
                  Selected workspaces
                </label>
              </div>
              {newLimit !== null && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {limitTo.map((w) => (
                    <label key={w} className="flex items-center gap-1.5 font-mono">
                      <input type="checkbox" checked={newLimit.includes(w)}
                        onChange={(e) => setNewLimit(e.target.checked ? [...newLimit, w] : newLimit.filter((x) => x !== w))} />
                      {w}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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

          {kind === "token_exchange" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Token URL"><input value={f.token_url ?? ""} onChange={set("token_url")} placeholder="https://auth.example.com/token" className={inputClass("font-mono")} autoComplete="off" /></Field>
              <Field label="client_id"><input value={f.client_id ?? ""} onChange={set("client_id")} className={inputClass("font-mono")} autoComplete="off" /></Field>
              <Field label="client_secret"><input type="password" value={f.client_secret ?? ""} onChange={set("client_secret")} className={inputClass("font-mono")} autoComplete="new-password" /></Field>
              <Field label="Client authentication at the token URL">
                <select value={f.token_auth ?? "client_secret_post"} onChange={set("token_auth")} className={selectClass("w-56")}>
                  <option value="client_secret_post">in the form body</option>
                  <option value="client_secret_basic">HTTP Basic</option>
                </select>
              </Field>
              <Field label="Subject: the secret whose token is traded"><input value={f.subject_secret ?? ""} onChange={set("subject_secret")} placeholder="UPSTREAM_TOKEN" className={inputClass("font-mono")} autoComplete="off" /></Field>
              <Field label="Audience (optional)"><input value={f.audience ?? ""} onChange={set("audience")} className={inputClass("font-mono")} autoComplete="off" /></Field>
              <Field label="Scopes (optional, fewer than the subject's)"><input value={f.scope ?? ""} onChange={set("scope")} className={inputClass("font-mono")} autoComplete="off" /></Field>
              <Field label="Requested token type (optional)"><input value={f.requested_token_type ?? ""} onChange={set("requested_token_type")} placeholder="urn:ietf:params:oauth:token-type:access_token" className={inputClass("font-mono")} autoComplete="off" /></Field>
              <p className="col-span-2 text-xs text-fg-muted">Declare the subject secret beside this one in an agent&apos;s secrets:. Each use trades its live token for the narrower one (RFC 8693), cached until it expires.</p>
            </div>
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
                <div className="col-span-2">
                  <Field label="Issuer — fills the URLs below from the provider's own metadata (optional)">
                    <div className="flex items-center gap-2">
                      <input value={f.issuer ?? ""} onChange={set("issuer")} placeholder="https://login.example.com" className={inputClass(cred)} autoComplete="off" />
                      <button type="button" disabled={discovering || !f.issuer?.trim()} onClick={() => void discover()} className={buttonClass("secondary")}>{discovering ? "Reading…" : "Discover"}</button>
                    </div>
                  </Field>
                  {f.iss_parameter && (
                    <p className="mt-1 text-xs text-fg-muted">
                      Found: {[f.revocation_url && "revocation", f.device_url && "device sign-in", f.par_url && "pushed requests (PAR)"].filter(Boolean).join(", ") || "authorize and token URLs"}
                      {f.iss_parameter === "true" ? " · the provider says who it is on every answer (RFC 9207), so foldrun checks it" : ""}
                    </p>
                  )}
                </div>
              )}
              {newApp && (
                <Field label="Authorize URL"><input value={f.authorize_url ?? ""} onChange={set("authorize_url")} placeholder="https://auth.example.com/authorize" className={inputClass(cred)} autoComplete="off" /></Field>
              )}
              {(kind === "oauth_m2m" || newApp) && <>
              <Field label="Token URL"><input value={f.token_url ?? ""} onChange={set("token_url")} placeholder="https://auth.example.com/token" className={inputClass(cred)} autoComplete="off" /></Field>
              <Field label="client_id"><input value={f.client_id ?? ""} onChange={set("client_id")} className={inputClass(cred)} autoComplete="off" /></Field>
              {f.token_auth !== "private_key_jwt" && f.token_auth !== "tls_client_auth" && (
                <Field label={kind === "oauth" ? "client_secret (empty for a public app)" : "client_secret"}><input type="password" value={f.client_secret ?? ""} onChange={set("client_secret")} className={inputClass(cred)} autoComplete="new-password" /></Field>
              )}
              <Field label="Client authentication at the token URL">
                <select value={f.token_auth ?? "client_secret_post"} onChange={set("token_auth")} className={selectClass("w-56")}>
                  <option value="client_secret_post">in the form body (most providers)</option>
                  <option value="client_secret_basic">HTTP Basic (Notion, Spotify, Reddit, Zoom)</option>
                  <option value="private_key_jwt">signed JWT with a key (Entra certificates, Okta, FAPI)</option>
                  <option value="tls_client_auth">client certificate — mutual TLS (banks, FAPI)</option>
                </select>
              </Field>
              <Field label="DPoP-bound tokens (Bluesky, Okta DPoP)">
                <select value={f.dpop ?? "off"} onChange={set("dpop")} className={selectClass("w-56")}>
                  <option value="off">off (most providers)</option>
                  <option value="on">on — use it through a site binding</option>
                </select>
              </Field>
              {f.token_auth === "tls_client_auth" && (
                <div className="col-span-2">
                  <Field label="Client certificate, PEM">
                    <textarea value={f.tls_client_cert ?? ""} onChange={set("tls_client_cert")} rows={2} placeholder="-----BEGIN CERTIFICATE-----" className={inputClass(cred)} autoComplete="off" />
                  </Field>
                  <Field label="Its private key, PEM">
                    <textarea value={f.tls_client_key ?? ""} onChange={set("tls_client_key")} rows={2} placeholder="-----BEGIN PRIVATE KEY-----" className={inputClass(cred)} autoComplete="off" />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">Presented to the token URL instead of a secret, and on the calls the token is bound to — bind this connection to the API&apos;s sites. The key is sealed and never shown again.</p>
                </div>
              )}
              {f.token_auth === "private_key_jwt" && (
                <div className="col-span-2">
                  <Field label="Private key, PEM or JWK — leave empty and foldrun makes one">
                    <textarea value={f.client_assertion_key ?? ""} onChange={set("client_assertion_key")} rows={3} placeholder="-----BEGIN PRIVATE KEY-----" className={inputClass(cred)} autoComplete="off" />
                  </Field>
                  <Field label="Its certificate, PEM (optional — Microsoft Entra names keys by it)">
                    <textarea value={f.client_assertion_cert ?? ""} onChange={set("client_assertion_cert")} rows={2} placeholder="-----BEGIN CERTIFICATE-----" className={inputClass(cred)} autoComplete="off" />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">
                    The key signs a short JWT at the token URL instead of sending a secret. It is stored sealed, like a secret, and never shown again.
                  </p>
                </div>
              )}
              {kind === "oauth" && (
                <Field label="PKCE">
                  <select value={f.pkce ?? "on"} onChange={set("pkce")} className={selectClass("w-56")}>
                    <option value="on">on (recommended)</option>
                    <option value="off">off — only if the provider refuses it</option>
                  </select>
                </Field>
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
        {notice && <p className="mt-2 text-xs text-fg-muted">{notice}</p>}
        {device && (
          <div className="mt-3 rounded border border-line p-3 text-xs">
            <div className="font-medium">On any device, open <a className="underline" href={device.verification_uri_complete ?? device.verification_uri} target="_blank" rel="noreferrer">{device.verification_uri}</a> and type this code:</div>
            <div className="mt-2 font-mono text-lg tracking-widest">{device.user_code}</div>
            <div className="mt-1 text-fg-muted">Waiting for the provider to say yes…</div>
          </div>
        )}
        {jwk && (
          <div className="mt-3 rounded border border-line p-3 text-xs">
            <div className="font-medium">Register this public key with the provider (as a JWK, or the JWKS it asks for). It is not secret.</div>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px]">{jwk.key}</pre>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(jwk.key)} className={buttonClass("secondary")}>Copy</button>
              {jwk.connect && <button type="button" onClick={() => { const n = jwk.connect!; setJwk(null); void connect(n); }} className={buttonClass("primary")}>Registered — connect</button>}
              {!jwk.connect && <button type="button" onClick={() => setJwk(null)} className={buttonClass("minimal")}>Done</button>}
            </div>
          </div>
        )}
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
                  {!workspace && s.scope === "account" && <SecretWorkspaces row={s} tenant={tenant} choices={limitTo} />}
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
