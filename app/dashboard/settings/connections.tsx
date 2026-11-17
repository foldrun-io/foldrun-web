"use client";

// Connections: how agents reach external tools. One form. Pick a type, fill
// the fields that type needs — no presets, no wizard; the users are
// programmers and know what a token URL is. Every connection is a vault
// secret under the hood; the type only decides which fields to ask for and
// how the value is used at run time.

import { $el, $rich, $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonVariants, Button } from "@foldrun/ui/react/button";
import { Input, Textarea } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { KeyRound } from "lucide-react";
import { EmptyState, IconBox, Tag, Chip, SectionTitle, Field, Callout } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Checkbox, RadioGroup, RadioGroupItem } from "@foldrun/ui/react/choice";

type Kind = "key" | "api" | "ssh" | "oauth" | "oauth_m2m" | "service_account" | "file" | "client_cert" | "identity" | "token_exchange";

const KIND_LABEL: Record<string, string> = {
  key: $t("settings.connections.apiKey"),
  api: $t("settings.connections.apiHeaders"),
  ssh: "SSH",
  "client-cert": $t("settings.connections.clientCertificate"),
  identity: $t("settings.connections.identityKeyless"),
  "token-exchange": $t("settings.connections.oauthTokenExchange"),
  oauth2: $t("settings.connections.oauthAutoRefresh"),
  "service-account": $t("settings.connections.serviceAccount"),
  file: $t("settings.connections.file"),
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
    return <p className="mt-0.5 text-xs text-danger">{$t("settings.connections.refreshFailedReconnectToFix", { slice: c.lastErrorAt?.slice(0, 10) ?? "", lastError: c.lastError ?? "" })}</p>;
  }
  if (c.status === "expired") return <p className="mt-0.5 text-xs text-danger">{$t("settings.connections.signInExpiredReconnectToFix")}</p>;
  if (c.status === "expiring") return <p className="mt-0.5 text-xs text-warning">{$t("settings.connections.signInExpiresInDays", { daysLeft: String(c.daysLeft ?? "") })}</p>;
  if (c.status === "no-client") return <p className="mt-0.5 text-xs text-fg-subtle">{$t("settings.connections.connectedNoSavedClientSoNo", { slice: c.connectedAt?.slice(0, 10) ?? "" })}</p>;
  return (
    <p className="mt-0.5 text-xs text-success">
      {$t("settings.connections.signInOk2", { part: c.daysLeft !== null ? $t("settings.connections.daysLeft", { daysLeft: String(c.daysLeft) }) : "", part2: c.connectedAt ? $t("settings.connections.connected", { v0: String(c.connectedAt.slice(0, 10)) }) : "" })}
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
    return <p className="mt-0.5 text-xs text-fg-subtle">{$t("settings.connections.notUsedYetNothingHasTried")}</p>;
  }
  const { last, refusals, lastAccepted } = health;
  const when = last.at.slice(0, 10);
  if (last.outcome === "refused") {
    return (
      <p className="mt-0.5 text-xs text-danger">
        {$t("settings.connections.refusedByOn", { host: last.host, when: when })}
        {last.status ? ` (${last.status})` : ""}
        {refusals > 1 ? $t("settings.connections.timesRunning", { refusals: String(refusals) }) : ""}
        {lastAccepted ? $t("settings.connections.lastWorked", { v0: String(lastAccepted.slice(0, 10)) }) : $t("settings.connections.neverSeenWorking")}
      </p>
    );
  }
  if (last.outcome === "error") {
    return (
      <p className="mt-0.5 text-xs text-warning">
        {$t("settings.connections.failedOn", { host: last.host, when: when })}
        {last.status ? ` (${last.status})` : ""}{" "}{$t("settings.connections.itsEndNotTheKey")}
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-xs text-success">
      {$t("settings.connections.acceptedByOn", { host: last.host, when: when })}
    </p>
  );
}

/** Sites a secret may be bound to: typed as a comma- or space-separated line. */
/** The App choice for entering a new app — not a valid app name, so it can never be one. */
const NEW_APP = "+new";

/** "name=value" lines → the authorize_extra map; a line without "=" is refused
 *  rather than dropped, so a typo never quietly loses a parameter. */
function parseAuthorizeExtra(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf("=");
    if (i < 1) throw new Error($t("settings.connections.extraAuthorizeParametersAreNameValue", { line: String(line) }));
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
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? $t("settings.connections.couldNotSave"));
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-1.5 text-xs">
      {!editing ? (
        <p className="flex flex-wrap items-center gap-1.5 text-fg-subtle">
          {sites.length ? (
            <>
              <span>{$t("settings.connections.sentOnlyTo")}</span>
              {sites.map((x) => <code key={x} className="font-mono text-fg">{x}</code>)}
              <span>{$t("settings.connections.neverInASandbox")}</span>
            </>
          ) : (
            <span>{$t("settings.connections.notBoundToSitesAStep")}</span>
          )}
          {editable && (
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-link underline-offset-2 hover:underline">
              {sites.length ? $t("settings.connections.editSites") : $t("settings.connections.bindToSites")}
            </button>
          )}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(parseSites(text)); }} className="flex flex-wrap items-center gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="api.example.com, *.example.org" autoFocus
            aria-label={$t("settings.connections.sitesMayBeSentTo", { name: String(row.name) })} className="w-72 font-mono text-xs" />
          <button type="submit" disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("settings.connections.save")}</button>
          {sites.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void save([])} className={buttonVariants({ variant: "secondary", size: "md" })}>{$t("settings.connections.unbind")}</button>
          )}
          <button type="button" onClick={() => { setEditing(false); setText(sites.join(", ")); }} className={buttonVariants({ variant: "ghost", size: "md" })}>{$t("settings.connections.cancel")}</button>
        </form>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
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
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? $t("settings.connections.couldNotSave"));
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
    <div className="mt-1.5 text-xs">
      {!editing ? (
        <p className="flex flex-wrap items-center gap-1.5 text-fg-subtle">
          <span>{$t("settings.connections.workspaces")}</span>
          {!limited ? (
            <span className="text-fg">{$t("settings.connections.all")}</span>
          ) : limited.length ? (
            <>
              <span>{$t("settings.connections.only")}</span>
              {limited.map((w) => <code key={w} className="font-mono text-fg">{w}</code>)}
            </>
          ) : (
            <span className="text-fg">{$t("settings.connections.noneNoWorkspaceCanUseIt")}</span>
          )}
          {choices && (
            <button type="button" onClick={() => {
              // From what the page holds NOW, not what it held when this row
              // first drew: a refresh since may have changed the list.
              setMode(row.workspaces ? "selected" : "all");
              setPicked(row.workspaces ?? []);
              setError(null);
              setEditing(true);
            }} className="font-medium text-link underline-offset-2 hover:underline">
              {$t("settings.connections.change")}
            </button>
          )}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-2">
          <RadioGroup className="flex flex-wrap items-center gap-3" aria-label={$t("settings.connections.workspaceThatMayUse", { name: String(row.name) })} value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <label className="flex items-center gap-1.5">
              {$rich("settings.connections.allTerm", { radioGroupItem: $el(<RadioGroupItem value="all" />) })}
            </label>
            <label className="flex items-center gap-1.5">
              {$rich("settings.connections.selectedTerm", { radioGroupItem: $el(<RadioGroupItem value="selected" />) })}
            </label>
          </RadioGroup>
          {mode === "selected" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {(choices ?? []).map((w) => (
                <label key={w} className="flex items-center gap-1.5 font-mono">
                  <Checkbox checked={picked.includes(w)}
                    onCheckedChange={(checked: boolean) => setPicked(checked ? [...picked, w] : picked.filter((x) => x !== w))} />
                  {w}
                </label>
              ))}
            </div>
          )}
          <p className="text-fg-muted">
            {$t("settings.connections.allIncludesWorkspaceMadeLaterA")}
          </p>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("settings.connections.save")}</button>
            <button type="button" onClick={() => setEditing(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>{$t("settings.connections.cancel")}</button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
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
    if (!res.ok || !j.config) throw new Error(j.error ?? $t("settings.connections.discoveryFailed"));
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
    else setError(data.error ?? $t("settings.connections.couldNotStartTheReconnect"));
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
    if (!res.ok) throw new Error(answer.error ?? $t("settings.connections.couldNotSave"));
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
        if (!j.token_uri) throw new Error($t("settings.connections.theKeyFileHasNoToken"));
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
          if (!f.scope?.trim()) throw new Error($t("settings.connections.typeTheScopesThisConnectionNeeds"));
          return connect(name, savedApp.name, f.scope);
        }
        if (!newApp) throw new Error($t("settings.connections.chooseAnAppASavedOne"));
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
        if (!saved.ok) throw new Error(answer.error ?? $t("settings.connections.couldNotSaveTheClient"));
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
    if (!f.scope?.trim()) { setError($t("settings.connections.typeTheScopesThisConnectionNeeds")); return; }
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
        if (Date.now() > deadline) throw new Error($t("settings.connections.theCodeRanOutBeforeAnyone"));
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
        if (!p.ok) throw new Error(r.error ?? $t("settings.connections.theConnectionStopped"));
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
    else setError(data.error ?? $t("settings.connections.couldNotStartTheFlow"));
  }

  async function remove(row: ConnectionRow) {
    const where = row.scope === "account" ? $t("settings.connections.everyWorkspaceInThisAccount") : workspace;
    if (
      !(await confirm({
        title: $t("settings.connections.delete", { name: String(row.name) }),
        body: $t("settings.connections.itIsRemovedFromAgentsUsing", { where: String(where), v1: String(row.kind === "oauth2" ? $t("settings.connections.itsGrantIsAlsoRevokedAt") : "") }),
        confirmLabel: $t("settings.connections.delete2"),
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
    if (r?.error) setNotice($t("settings.connections.isDeletedButRevokeTheApp", { name: String(row.name), error: String(r.error) }));
    else if (r?.revoked.length) setNotice($t("settings.connections.isDeletedAndItsGrantRevoked", { name: String(row.name) }));
    else if (r?.skipped === "shared-grant") setNotice($t("settings.connections.isDeletedItsGrantWasNot", { name: String(row.name) }));
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
      {heading && <SectionTitle title={$t("settings.connections.connections")} />}
      <div className="mb-8 min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="p-5 sm:p-6">
        <div className="mb-4 min-w-0 space-y-1.5">
          <h2 className="text-lg font-semibold text-fg">{$t("settings.connections.addAConnection")}</h2>
          <p className="text-sm text-fg-muted">{$rich("settings.connections.aCredentialAgentsUseByName", { code: (chunks) => <code className="font-mono">{chunks}</code> })}</p>
        </div>
        <form id="new-connection" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4" autoComplete="off">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={$t("settings.connections.name")}>
              <Input value={name} autoComplete="off"
                onChange={(e) => { setError(null); setName(e.target.value.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_")); }}
                placeholder="CRM_TOKEN" className="w-full font-mono" />
            </Field>
            <Field label={$t("settings.connections.type")}>
              <Select
                value={kind}
                onChange={(e) => {
                  setError(null);
                  setKind(e.target.value as Kind);
                  setApp("");
                  setF({});
                }}
                className="w-full"
              >
                <option value="key">{$t("settings.connections.apiKeyToken")}</option>
                <option value="api">{$t("settings.connections.apiBaseUrlHeaders")}</option>
                <option value="ssh">{$t("settings.connections.ssh")}</option>
                <option value="client_cert">{$t("settings.connections.clientCertificateMutualTls")}</option>
                <option value="identity">{$t("settings.connections.identityKeylessCloudAccess")}</option>
                <option value="token_exchange">{$t("settings.connections.oauthTokenExchange2")}</option>
                {/* Browser OAuth needs a saved app, which is account-scoped (an
                    app belongs to the account): a workspace connects through one
                    the account saved, and saves none itself. The other two are
                    self-contained secrets and work at either scope. */}
                {(!workspace || clients.length > 0) && <option value="oauth">{$t("settings.connections.oauthBrowserSignIn")}</option>}
                <option value="oauth_m2m">{$t("settings.connections.oauthClientCredentials")}</option>
                <option value="service_account">{$t("settings.connections.serviceAccountJsonKey")}</option>
                <option value="file">{$t("settings.connections.fileSshKeyCertificate")}</option>
              </Select>
            </Field>
          </div>

          {!workspace && limitTo && !oauthBrowser && (
            <div className="space-y-1.5 text-sm text-fg-secondary" role="radiogroup" aria-label={$t("settings.connections.workspaceThatMayUseIt")}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-fg">{$t("settings.connections.workspace")}</span>
                <RadioGroup className="flex flex-wrap items-center gap-3" aria-label={$t("settings.connections.workspaceThatMayUseIt")} value={newLimit === null ? "all" : "selected"} onValueChange={(v) => setNewLimit(v === "all" ? null : [])}>
                  <label className="flex items-center gap-1.5">
                    {$rich("settings.connections.allTerm", { radioGroupItem: $el(<RadioGroupItem value="all" />) })}
                  </label>
                  <label className="flex items-center gap-1.5">
                    {$rich("settings.connections.selectedTerm", { radioGroupItem: $el(<RadioGroupItem value="selected" />) })}
                  </label>
                </RadioGroup>
              </div>
              {newLimit !== null && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {limitTo.map((w) => (
                    <label key={w} className="flex items-center gap-1.5 font-mono">
                      <Checkbox checked={newLimit.includes(w)}
                        onCheckedChange={(checked: boolean) => setNewLimit(checked ? [...newLimit, w] : newLimit.filter((x) => x !== w))} />
                      {w}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {kind === "key" && (
            <>
              <Field label={$t("settings.connections.valueWriteOnly")}>
                <Input type="password" value={f.value ?? ""} onChange={set("value")} autoComplete="new-password" className={cred} />
              </Field>
              <Field label={$t("settings.connections.sitesOptional")}>
                <Input value={f.sites ?? ""} onChange={set("sites")} placeholder="api.example.com, *.example.org" autoComplete="off" className={`w-72 ${cred}`} />
              </Field>
              <p className="text-xs text-fg-muted">
                {$t("settings.connections.boundToSitesTheValueNever")}{" "}<code className="font-mono">{`\${${name || "NAME"}}`}</code>{" "}{$t("settings.connections.andTheEgressProxyFillsIt")}
              </p>
            </>
          )}

          {kind === "ssh" && (
            <>
              <div className="flex flex-wrap gap-2">
                <Field label={$t("settings.connections.host")}><Input value={f.host ?? ""} onChange={set("host")} placeholder="10.0.4.20" className={`w-56 ${cred}`} autoComplete="off" /></Field>
                <Field label={$t("settings.connections.port")}><Input value={f.port ?? ""} onChange={set("port")} placeholder="22" className={`w-20 ${cred}`} autoComplete="off" /></Field>
                <Field label={$t("settings.connections.username")}><Input value={f.user ?? ""} onChange={set("user")} placeholder="deploy" className={`w-40 ${cred}`} autoComplete="off" /></Field>
                <Field label={$t("settings.connections.auth")}>
                  <Select value={f.auth ?? "key"} onChange={set("auth")} >
                    <option value="key">{$t("settings.connections.privateKey")}</option>
                    <option value="password">{$t("settings.connections.password")}</option>
                  </Select>
                </Field>
              </div>
              {(f.auth ?? "key") === "key" ? (
                <Field label={$t("settings.connections.privateKey")}>
                  <Textarea value={f.key ?? ""} onChange={set("key")} rows={4}
                    placeholder={$t("settings.connections.beginOpensshPrivateKey")} className={cred} />
                </Field>
              ) : (
                <Field label={$t("settings.connections.password")}>
                  <Input type="password" value={f.password ?? ""} onChange={set("password")} autoComplete="new-password" className={cred} />
                </Field>
              )}
              <p className="text-xs text-fg-muted">
                {$rich("settings.connections.theAgentGetsAReadyTo2", { part: $t("settings.connections.text", { v0: String(name || "NAME") }), code: (chunks) => <code className="font-mono">{chunks}</code> })}
              </p>
            </>
          )}

          {kind === "api" && (
            <>
              <Field label={$t("settings.connections.baseUrlOptional")}>
                <Input value={f.base_url ?? ""} onChange={set("base_url")} placeholder="https://api.stripe.com" className={cred} autoComplete="off" />
              </Field>
              <Field label={$t("settings.connections.headersOnePerLineNameValue")}>
                <Textarea value={f.headers ?? ""} onChange={set("headers")} rows={3}
                  placeholder={"Authorization: Bearer sk_live_…\nStripe-Version: 2026-01-28"} className={cred} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Field label={$t("settings.connections.basicUsernameOptional")}>
                  <Input value={f.basic_user ?? ""} onChange={set("basic_user")} className={cred} autoComplete="off" />
                </Field>
                <Field label={$t("settings.connections.basicPassword")}>
                  <Input type="password" value={f.basic_password ?? ""} onChange={set("basic_password")} className={cred} autoComplete="new-password" />
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                {$t("settings.connections.theAgentGetsACurlWith")}{" "}<code className="font-mono">{`"$${name || "NAME"}" /v1/charges`}</code>{" "}{$t("settings.connections.theSecretNeverAppearsInThe")}
              </p>
            </>
          )}

          {kind === "file" && (
            <Field label={$t("settings.connections.fileContentsWrittenToA0600")}>
              <Textarea value={f.file ?? ""} onChange={set("file")} rows={4}
                placeholder={$t("settings.connections.beginOpensshPrivateKey")} className={cred} />
            </Field>
          )}

          {kind === "token_exchange" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={$t("settings.connections.tokenUrl")}><Input value={f.token_url ?? ""} onChange={set("token_url")} placeholder="https://auth.example.com/token" className="font-mono" autoComplete="off" /></Field>
              <Field label="client_id"><Input value={f.client_id ?? ""} onChange={set("client_id")} className="font-mono" autoComplete="off" /></Field>
              <Field label="client_secret"><Input type="password" value={f.client_secret ?? ""} onChange={set("client_secret")} className="font-mono" autoComplete="new-password" /></Field>
              <Field label={$t("settings.connections.clientAuthenticationAtTheTokenUrl")}>
                <Select value={f.token_auth ?? "client_secret_post"} onChange={set("token_auth")} className="w-56">
                  <option value="client_secret_post">{$t("settings.connections.inTheFormBody")}</option>
                  <option value="client_secret_basic">{$t("settings.connections.httpBasic")}</option>
                </Select>
              </Field>
              <Field label={$t("settings.connections.subjectTheSecretWhoseTokenIs")}><Input value={f.subject_secret ?? ""} onChange={set("subject_secret")} placeholder="UPSTREAM_TOKEN" className="font-mono" autoComplete="off" /></Field>
              <Field label={$t("settings.connections.audienceOptional")}><Input value={f.audience ?? ""} onChange={set("audience")} className="font-mono" autoComplete="off" /></Field>
              <Field label={$t("settings.connections.scopesOptionalFewerThanTheSubject")}><Input value={f.scope ?? ""} onChange={set("scope")} className="font-mono" autoComplete="off" /></Field>
              <Field label={$t("settings.connections.requestedTokenTypeOptional")}><Input value={f.requested_token_type ?? ""} onChange={set("requested_token_type")} placeholder="urn:ietf:params:oauth:token-type:access_token" className="font-mono" autoComplete="off" /></Field>
              <p className="text-xs sm:col-span-2 text-fg-muted">{$t("settings.connections.declareTheSubjectSecretBesideThis")}</p>
            </div>
          )}
          {kind === "identity" && <IdentityFields tenant={tenant} workspace={workspace} audience={f.audience ?? ""} onAudience={set("audience")} />}

          {kind === "client_cert" && (
            <>
              <Field label={$t("settings.connections.certificatePemChainIncluded")}>
                <Textarea value={f.cert ?? ""} onChange={set("cert")} rows={3} placeholder={$t("settings.connections.beginCertificate")} className={cred} />
              </Field>
              <Field label={$t("settings.connections.privateKeyPem")}>
                <Textarea value={f.cert_key ?? ""} onChange={set("cert_key")} rows={3} placeholder={$t("settings.connections.beginPrivateKey")} className={cred} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Field label={$t("settings.connections.passphraseIfTheKeyHasOne")}>
                  <Input type="password" value={f.passphrase ?? ""} onChange={set("passphrase")} className={cred} autoComplete="new-password" />
                </Field>
                <Field label={$t("settings.connections.sitesItIsPresentedToExact")}>
                  <Input value={f.sites ?? ""} onChange={set("sites")} placeholder="api.bank.example" className={`w-72 ${cred}`} autoComplete="off" />
                </Field>
                <Field label={$t("settings.connections.inTheSandbox")}>
                  <Select value={f.cert_export ?? "no"} onChange={set("cert_export")} className="w-64">
                    <option value="no">{$t("settings.connections.neverTheEgressProxyPresentsIt")}</option>
                    <option value="yes">{$t("settings.connections.asFilesTooAStepWith")}</option>
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-fg-muted">
                {$t("settings.connections.theEgressProxyPresentsItOn")}
              </p>
            </>
          )}

          {kind === "service_account" && (
            <>
              <Field label={$t("settings.connections.serviceAccountJsonKeyPasteThe")}>
                {/* The placeholder shows the SHAPE of a key so a person knows what
                    to paste; the scanner sees the shape too. It is a prompt with
                    ellipses in it, not a credential. */}
                <Textarea value={f.json ?? ""} onChange={set("json")} rows={4}
                  placeholder={$t("settings.connections.typeServiceAccountClientEmailPrivate")} className={cred} /> {/* nosemgrep: generic.secrets.security.detected-google-gcm-service-account.detected-google-gcm-service-account */}
              </Field>
              <Field label={$t("settings.connections.scopesSpaceSeparated")}>
                <Input value={f.scope ?? ""} onChange={set("scope")} placeholder={$t("settings.connections.theScopesTheProviderDocuments")} className={cred} />
              </Field>
              <Field label={$t("settings.connections.actAsOptionalTheUserIt")}>
                <Input value={f.subject ?? ""} onChange={set("subject")} placeholder="ana@example.com" className={cred} autoComplete="off" />
              </Field>
            </>
          )}

          {(kind === "oauth" || kind === "oauth_m2m") && (
            <div className="grid gap-3 sm:grid-cols-2">
              {kind === "oauth" && clients.length > 0 && (
                <Field label={$t("settings.connections.app")}>
                  <Select
                    value={app}
                    // Scopes are not carried over from the app: each connection
                    // asks for its own, typed for what it is for.
                    onChange={(e) => { setError(null); setApp(e.target.value); setF({ ...f, scope: "" }); }}
                    className="w-72"
                  >
                    <option value="" disabled>{$t("settings.connections.chooseAnApp")}</option>
                    {!workspace && <option value={NEW_APP}>{$t("settings.connections.aNewAppEnterItsClient")}</option>}
                    {clients.map((c) => <option key={c.name} value={c.name}>{$t("settings.connections.saved", { name: c.name })}</option>)}
                  </Select>
                </Field>
              )}
              {savedApp && (
                <p className="text-xs sm:col-span-2 text-fg-muted">
                  {$rich("settings.connections.connectsWithTheSavedAppAsk", { name: savedApp.name, code: (chunks) => <code className="font-mono">{chunks}</code> })}
                </p>
              )}
              {newApp && (
                // First, because it is the step people do somewhere else: the
                // provider's console refuses a redirect it has not seen, and
                // the address is whichever one this page was opened at.
                <Callout tone="warning" className="sm:col-span-2 px-3 py-2 text-xs">
                  <div className="font-medium">{$t("settings.connections.1RegisterThisRedirectUrlOn")}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="font-mono break-all">{redirect || "…/api/oauth/callback"}</code>
                    <button type="button" onClick={copyRedirect} className={buttonVariants({ variant: "secondary", size: "md" })}>{copied ? $t("settings.connections.copied") : $t("settings.connections.copy")}</button>
                  </div>
                  <div className="mt-1">
                    {$t("settings.connections.itIsTheAddressYouOpened")}
                  </div>
                </Callout>
              )}
              {newApp && (
                <div className="sm:col-span-2">
                  <Field label={$t("settings.connections.issuerFillsTheUrlsBelowFrom")}>
                    <div className="flex items-center gap-2">
                      <Input value={f.issuer ?? ""} onChange={set("issuer")} placeholder="https://login.example.com" className={cred} autoComplete="off" />
                      <button type="button" disabled={discovering || !f.issuer?.trim()} onClick={() => void discover()} className={buttonVariants({ variant: "secondary", size: "md" })}>{discovering ? $t("settings.connections.reading") : $t("settings.connections.discover")}</button>
                    </div>
                  </Field>
                  {f.iss_parameter && (
                    <p className="mt-1 text-xs text-fg-muted">
                      {$t("settings.connections.found2", { join: [f.revocation_url && $t("settings.connections.revocation"), f.device_url && $t("settings.connections.deviceSignIn"), f.par_url && $t("settings.connections.pushedRequestsPar")].filter(Boolean).join(", ") || $t("settings.connections.authorizeAndTokenUrls") })}
                      {f.iss_parameter === "true" ? $t("settings.connections.theProviderSaysWhoItIs") : ""}
                    </p>
                  )}
                </div>
              )}
              {newApp && (
                <Field label={$t("settings.connections.authorizeUrl")}><Input value={f.authorize_url ?? ""} onChange={set("authorize_url")} placeholder="https://auth.example.com/authorize" className={cred} autoComplete="off" /></Field>
              )}
              {(kind === "oauth_m2m" || newApp) && <>
              <Field label={$t("settings.connections.tokenUrl")}><Input value={f.token_url ?? ""} onChange={set("token_url")} placeholder="https://auth.example.com/token" className={cred} autoComplete="off" /></Field>
              <Field label="client_id"><Input value={f.client_id ?? ""} onChange={set("client_id")} className={cred} autoComplete="off" /></Field>
              {f.token_auth !== "private_key_jwt" && f.token_auth !== "tls_client_auth" && (
                <Field label={kind === "oauth" ? $t("settings.connections.clientSecretEmptyForAPublic") : "client_secret"}><Input type="password" value={f.client_secret ?? ""} onChange={set("client_secret")} className={cred} autoComplete="new-password" /></Field>
              )}
              <Field label={$t("settings.connections.clientAuthenticationAtTheTokenUrl")}>
                <Select value={f.token_auth ?? "client_secret_post"} onChange={set("token_auth")} className="w-56">
                  <option value="client_secret_post">{$t("settings.connections.inTheFormBodyMostProviders")}</option>
                  <option value="client_secret_basic">{$t("settings.connections.httpBasicNotionSpotifyRedditZoom")}</option>
                  <option value="private_key_jwt">{$t("settings.connections.signedJwtWithAKeyEntra")}</option>
                  <option value="tls_client_auth">{$t("settings.connections.clientCertificateMutualTlsBanksFapi")}</option>
                </Select>
              </Field>
              <Field label={$t("settings.connections.dpopBoundTokensBlueskyOktaDpop")}>
                <Select value={f.dpop ?? "off"} onChange={set("dpop")} className="w-56">
                  <option value="off">{$t("settings.connections.offMostProviders")}</option>
                  <option value="on">{$t("settings.connections.onUseItThroughASite")}</option>
                </Select>
              </Field>
              {f.token_auth === "tls_client_auth" && (
                <div className="sm:col-span-2">
                  <Field label={$t("settings.connections.clientCertificatePem")}>
                    <Textarea value={f.tls_client_cert ?? ""} onChange={set("tls_client_cert")} rows={2} placeholder={$t("settings.connections.beginCertificate")} className={cred} autoComplete="off" />
                  </Field>
                  <Field label={$t("settings.connections.itsPrivateKeyPem")}>
                    <Textarea value={f.tls_client_key ?? ""} onChange={set("tls_client_key")} rows={2} placeholder={$t("settings.connections.thePemPrivateKeyBeginPrivate")} className={cred} autoComplete="off" />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">{$t("settings.connections.presentedToTheTokenUrlInstead")}</p>
                </div>
              )}
              {f.token_auth === "private_key_jwt" && (
                <div className="sm:col-span-2">
                  <Field label={$t("settings.connections.privateKeyPemOrJwkLeave")}>
                    <Textarea value={f.client_assertion_key ?? ""} onChange={set("client_assertion_key")} rows={3} placeholder={$t("settings.connections.thePemPrivateKeyBeginPrivate")} className={cred} autoComplete="off" />
                  </Field>
                  <Field label={$t("settings.connections.itsCertificatePemOptionalMicrosoftEntra")}>
                    <Textarea value={f.client_assertion_cert ?? ""} onChange={set("client_assertion_cert")} rows={2} placeholder={$t("settings.connections.beginCertificate")} className={cred} autoComplete="off" />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">
                    {$t("settings.connections.theKeySignsAShortJwt")}
                  </p>
                </div>
              )}
              {kind === "oauth" && (
                <Field label="PKCE">
                  <Select value={f.pkce ?? "on"} onChange={set("pkce")} className="w-56">
                    <option value="on">{$t("settings.connections.onRecommended")}</option>
                    <option value="off">{$t("settings.connections.offOnlyIfTheProviderRefuses")}</option>
                  </Select>
                </Field>
              )}
              {kind === "oauth" && (
                <div className="sm:col-span-2">
                  <Field label={$t("settings.connections.extraAuthorizeParametersOptionalOneName")}>
                    <Textarea value={f.authorize_extra ?? ""} onChange={set("authorize_extra")} rows={2} placeholder="name=value" className={cred} />
                  </Field>
                  <p className="mt-1 text-xs text-fg-muted">
                    {$rich("settings.connections.whateverElseTheProviderSAuthorize", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
                  </p>
                </div>
              )}
              </>}
              {(kind === "oauth_m2m" || savedApp || newApp) && (
                <Field label={$t("settings.connections.scopesSpaceSeparated")}><Input value={f.scope ?? ""} onChange={set("scope")} className={cred} autoComplete="off" /></Field>
              )}
            </div>
          )}
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {notice && <p className="mt-3 text-sm text-fg-muted">{notice}</p>}
        {device && (
          <div className="mt-4 rounded-md border border-line bg-sunken p-4 text-sm">
            <div className="font-medium text-fg">{$rich("settings.connections.onAnyDeviceOpenAndType", { verification_uri: device.verification_uri, a: (chunks) => <a className="underline" href={device.verification_uri_complete ?? device.verification_uri} target="_blank" rel="noreferrer">{chunks}</a> })}</div>
            <div className="mt-2 font-mono text-lg tracking-widest">{device.user_code}</div>
            <div className="mt-1 text-fg-muted">{$t("settings.connections.waitingForTheProviderToSay")}</div>
          </div>
        )}
        {jwk && (
          <div className="mt-4 rounded-md border border-line bg-sunken p-4 text-sm">
            <div className="font-medium text-fg">{$t("settings.connections.registerThisPublicKeyWithThe")}</div>
            <pre className="mt-2 overflow-x-auto font-mono text-xs text-fg-secondary">{jwk.key}</pre>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(jwk.key)} className={buttonVariants({ variant: "secondary", size: "md" })}>{$t("settings.connections.copy")}</button>
              {jwk.connect && <button type="button" onClick={() => { const n = jwk.connect!; setJwk(null); void connect(n); }} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("settings.connections.registeredConnect")}</button>}
              {!jwk.connect && <button type="button" onClick={() => setJwk(null)} className={buttonVariants({ variant: "ghost", size: "md" })}>{$t("settings.connections.done")}</button>}
            </div>
          </div>
        )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-5 py-3 text-sm text-fg-muted sm:px-6">
          <span className="min-w-0">{$t("settings.connections.theValueIsWriteOnlyNobody")}</span>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {savedApp?.device_url && (
              <Button type="button" variant="secondary" disabled={busy || !name} onClick={() => void connectWithCode()}>{$t("settings.connections.connectWithACode")}</Button>
            )}
            <Button type="submit" form="new-connection" variant="primary" disabled={busy || !name || (oauthBrowser && !savedApp && !newApp)}>
              {oauthBrowser ? (savedApp ? $t("settings.connections.connect") : $t("settings.connections.saveConnect")) : $t("settings.connections.save")}
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-end justify-between gap-2 px-1">
        <h2 className="text-base font-medium text-fg">{workspace ? $t("settings.connections.connectionsHere") : $t("settings.connections.connections")}</h2>
        <span className="text-sm tabular-nums text-fg-muted">{secrets.length}</span>
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
        {secrets.length === 0 ? (
          <EmptyState bare compact icon={<KeyRound />} title={$t("settings.connections.noConnectionsYet")} description={$t("settings.connections.addOneAboveAgentsReceiveIt")} />
        ) : (
          <ul className="divide-y divide-line">
            {secrets.map((s) => { const grant = grantOf(s); /* any kind: a plain token from an OAuth consent has a connection too */ return (
              <li key={`${s.scope}:${s.name}`} className={cn("flex min-w-0 flex-wrap items-start gap-3 px-4 py-3.5 sm:px-5", wanted === s.name && "bg-warning-soft")}>
                <IconBox className="mt-0.5 max-sm:hidden"><KeyRound /></IconBox>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                    <span className="mr-0.5 break-all font-mono">{s.name}</span>
                    <Tag>{KIND_LABEL[s.kind ?? "key"]}</Tag>
                    {workspace && s.scope === "account" && <Chip>{$t("settings.connections.inherited")}</Chip>}
                    {s.shadowed && <Chip tone="warn">{$t("settings.connections.overridesAccount")}</Chip>}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">{$t("settings.connections.updated", { slice: s.updatedAt.slice(0, 10) })}</p>
                  {grant && <GrantStatus c={grant} />}
                  <SecretHealth health={s.health ?? null} />
                  <SecretSites row={s} tenant={tenant} workspace={workspace} editable={!workspace || s.scope === "workspace"} />
                  {!workspace && s.scope === "account" && <SecretWorkspaces row={s} tenant={tenant} choices={limitTo} />}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                {grant?.client && (!workspace || s.scope === "workspace") ? (
                  <Button variant={grant.status === "ok" ? "secondary" : "primary"} onClick={() => reconnect(s)}>{$t("settings.connections.reconnect")}</Button>
                ) : !workspace && hasClient(s.name) && (
                  <Button variant="secondary" onClick={() => connect(s.name)}>{$t("settings.connections.reconnect")}</Button>
                )}
                {(!workspace || s.scope === "workspace") && (
                  <Button variant="ghost" className="hover:text-danger" onClick={() => remove(s)}>{$t("settings.connections.delete2")}</Button>
                )}
                </div>
              </li>
            ); })}
          </ul>
        )}
      </div>
      <p className="mt-3 px-1 text-sm text-fg-muted">
        {$rich("settings.connections.anAgentDeclaresSecretsToReceive", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
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
      <Field label={$t("settings.connections.audienceTheValueYourCloudS")}>
        <Input value={audience} onChange={onAudience} placeholder="sts.amazonaws.com" className="w-full max-w-md font-mono" autoComplete="off" />
      </Field>
      {info && !info.enabled ? (
        <p className="text-xs text-danger">{$t("settings.connections.thisInstallDoesNotIssueIdentity")}</p>
      ) : info ? (
        <div className="text-xs text-fg-muted">
          <p>{$rich("settings.connections.trustThisIssuerInYourCloud", { issuer: info.issuer ?? "", code: (chunks) => <code className="font-mono text-fg">{chunks}</code> })}</p>
          <p className="mt-1">{$rich("settings.connections.eachAgentSTokensCarryThe", { subject: info.subject, code: (chunks) => <code className="font-mono text-fg">{chunks}</code> })}</p>
          <p className="mt-1">{$rich("settings.connections.aStepThatDeclaresItGets", { code: (chunks) => <code className="font-mono">{chunks}</code> })}</p>
        </div>
      ) : null}
    </>
  );
}
