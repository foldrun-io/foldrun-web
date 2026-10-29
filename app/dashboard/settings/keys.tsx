"use client";

import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { WithEmails } from "@/components/email";
import { useState } from "react";
import { buttonClass, inputClass, Card } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useCan } from "@/components/role";
import { ASSIGNABLE, type Role } from "@/platform/permissions";

interface KeyRow {
  createdBy?: string;
  id: string;
  prefix: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  scope?: { workspace: string; access: "read" | "write" };
  /** Absent on keys older than roles, which act as admin. */
  role?: Role;
  /** Which workspaces it opens; null or absent for all. */
  workspaces?: string[] | null;
  /** When it stops working; null or absent never. */
  expiresAt?: string | null;
  /** When it last authenticated, and from where (a /24 or /48). */
  lastUsedAt?: string | null;
  lastIp?: string | null;
  /** The id of the key that replaced it in a rotation. */
  replacedBy?: string | null;
  /** "cli-login" for a key `foldrun login` minted: it renews itself. */
  origin?: "cli-login";
}

const EXPIRY = [
  { v: "30d", label: "30 days" },
  { v: "90d", label: "90 days" },
  { v: "365d", label: "1 year" },
  { v: "never", label: "Never expires" },
];
const GRACE = [
  { v: "0", label: "Revoke the old key now" },
  { v: "1h", label: "Keep the old key 1 hour" },
  { v: "24h", label: "Keep the old key 24 hours" },
];

/** "3 days ago", "in 5 days" — coarse on purpose. */
function relative(iso: string, now = Date.now()): string {
  const d = Date.parse(iso) - now;
  const abs = Math.abs(d);
  const [n, unit] = abs < 3_600_000 ? [Math.max(1, Math.round(abs / 60_000)), "minute"] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "hour"] : [Math.round(abs / 86_400_000), "day"];
  const words = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return d < 0 ? `${words} ago` : `in ${words}`;
}

export function KeyManager({
  tenant,
  keys,
  workspaces,
  scoped,
}: {
  tenant: string;
  keys: KeyRow[];
  /** The workspaces the person minting can open — the most a key can get. */
  workspaces: string[];
  /** Whether that list is a scope (some workspaces) rather than everything. */
  scoped: boolean;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [label, setLabel] = useState("");
  // Editor by default: enough to run, deploy and edit from CI, never enough
  // to read the vault or mint another key.
  const [role, setRole] = useState<Role>("editor");
  // A key that ends is a key that cannot leak forever. 90 days unless said.
  const [expires, setExpires] = useState("90d");
  const [rotating, setRotating] = useState<string | null>(null);
  const [grace, setGrace] = useState("1h");
  // Narrowing is a choice; the default is everything the minter can open.
  // A key can never open more than that — the server refuses — so the
  // picker only ever takes workspaces away.
  const [narrow, setNarrow] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const manages = useCan("keys:manage");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return; // one intent, one key: a double-click minted a second,
    setBusy(true); // undisplayed key that could only be found by its prefix.
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Unsaid, the scope is the minter's own; a list narrows it.
        body: JSON.stringify({ tenant, label, role, expires, ...(narrow ? { workspaces: chosen } : {}) }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreated(data.key);
        setLabel("");
        setNarrow(false);
        setChosen([]);
        router.refresh();
      } else {
        setError(data.error ?? "failed to create key");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!(await confirm({
      title: "Revoke this key?",
      body: "Clients using it stop working immediately.",
      confirmLabel: "Revoke",
    }))) return;
    await fetch("/api/keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant, id }),
    });
    router.refresh();
  };

  const rotate = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}/rotate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grace }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreated(data.key);
        setRotating(null);
        router.refresh();
      } else setError(data.error ?? "failed to rotate the key");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to rotate the key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      {confirmDialog}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">API keys</h2>
        {manages && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Key name (e.g. laptop, CI)"
              className={inputClass("w-52")}
            />
            {/* A key carries a role like a member does. Editor is the default
                and the right answer for CI; admin is for a key that manages
                the account and should be rare. */}
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-md border border-line-strong px-2 py-1.5 text-sm text-fg-secondary"
              aria-label="Role for the key"
            >
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="rounded-md border border-line-strong px-2 py-1.5 text-sm text-fg-secondary"
              aria-label="When the key expires"
            >
              {EXPIRY.map((x) => (
                <option key={x.v} value={x.v}>
                  {x.label}
                </option>
              ))}
            </select>
            <button className={buttonClass("primary")} disabled={busy || (narrow && chosen.length === 0)}>
              {busy ? "…" : "Create key"}
            </button>
          </form>
        )}
      </div>

      {manages && (
        <div className="mb-3 text-xs text-fg-muted">
          {/* What the key will be able to reach, said before it exists. A
              key is never more than its minter: a role at or below yours,
              and only workspaces you can open. */}
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} />
            Limit to some workspaces
          </label>
          {!narrow && (
            <span className="ml-2">
              The key will open {scoped ? `the ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} you can open` : "every workspace"}, at the role you pick — never above your own.
            </span>
          )}
          {narrow && (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {workspaces.map((w) => (
                <label key={w} className="inline-flex items-center gap-1.5 font-mono text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={chosen.includes(w)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, w] : c.filter((x) => x !== w)))}
                  />
                  {w}
                </label>
              ))}
              {workspaces.length === 0 && <span>No workspaces yet.</span>}
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {created && (
        <Card className="mb-3 border-green-300 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-900">
            Key created — copy it now, it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-surface px-3 py-2 font-mono text-xs text-fg ring-1 ring-inset ring-green-200">
              {created}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(created);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className={buttonClass("secondary")}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setCreated(null)} className={buttonClass("minimal")}>
              Done
            </button>
          </div>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-green-800">
            export FOLDRUN_TOKEN={created.slice(0, 12)}…
          </p>
        </Card>
      )}

      <Card>
        {keys.length === 0 ? (
          <p className="px-5 py-6 text-sm text-fg-muted">
            No keys yet. Create one to authenticate the CLI and API.
          </p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-fg">
                    {k.label}
                    <span
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
                      title={k.role ? "What this key may do" : "Minted before roles existed — acts as admin"}
                    >
                      {k.role ?? "admin"}
                    </span>
                    {k.scope && (
                      <span
                        className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-secondary"
                        title="A deploy key, for the platform's own git — which went on 17 Oct 2026, so it opens nothing now. Revoke it."
                      >
                        deploy key · opens nothing · revoke
                      </span>
                    )}
                    {!k.scope && (
                      <span
                        className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-secondary"
                        title={k.workspaces ? "The workspaces this key opens — its minter's at the time, or fewer" : "Every workspace in the account"}
                      >
                        {k.workspaces ? (k.workspaces.length === 0 ? "no workspaces" : k.workspaces.join(", ")) : "all workspaces"}
                      </span>
                    )}
                    {k.replacedBy && (() => {
                      const next = keys.find((n) => n.id === k.replacedBy);
                      return (
                        <span
                          className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-secondary"
                          title="Rotated: this key is not rotated again — rotate the new one (also if its secret was lost)"
                        >
                          rotated → {next ? `${next.label} · ${next.prefix}…` : k.replacedBy}
                        </span>
                      );
                    })()}
                    {k.revokedAt && (
                      <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                        revoked
                      </span>
                    )}
                    {!k.revokedAt && k.expiresAt && Date.parse(k.expiresAt) <= Date.now() && (
                      <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">expired</span>
                    )}
                    {k.origin === "cli-login" && !k.revokedAt && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-fg-secondary" title="Minted by foldrun login on that machine. It lasts 90 days and the CLI renews it while the machine is in use; revoke it to sign that machine out.">
                        CLI sign-in · renews itself
                      </span>
                    )}
                    {!k.revokedAt && k.origin !== "cli-login" && k.expiresAt && Date.parse(k.expiresAt) > Date.now() && Date.parse(k.expiresAt) - Date.now() < 7 * 86_400_000 && (
                      <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">expires {relative(k.expiresAt)}</span>
                    )}
                  </p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-fg-muted sm:grid-cols-4">
                    <div>
                      <dt className="inline text-fg-subtle">Created </dt>
                      <dd className="inline"><LocalTime iso={k.createdAt} options={{ dateStyle: "medium" }} />{k.createdBy ? <> by <WithEmails text={k.createdBy} /></> : ""}</dd>
                    </div>
                    <div>
                      <dt className="inline text-fg-subtle">Last used </dt>
                      <dd className="inline" title={k.lastIp ? `from ${k.lastIp}` : undefined}>
                        {k.lastUsedAt ? <>{relative(k.lastUsedAt)}{k.lastIp ? <span className="font-mono text-fg-subtle"> · {k.lastIp}</span> : null}</> : "never"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-fg-subtle">Expires </dt>
                      <dd className="inline">{k.expiresAt ? <LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} /> : "never"}</dd>
                    </div>
                    <div className="font-mono text-fg-subtle">{k.prefix}… · {k.id}</div>
                  </dl>
                  {rotating === k.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-fg-tertiary">A new key with this label, role and workspaces —</span>
                      <select value={grace} onChange={(e) => setGrace(e.target.value)} className="rounded-md border border-line-strong px-2 py-1 text-xs text-fg-secondary" aria-label="What happens to the old key">
                        {GRACE.map((g) => (
                          <option key={g.v} value={g.v}>{g.label}</option>
                        ))}
                      </select>
                      <button onClick={() => void rotate(k.id)} disabled={busy} className={buttonClass("primary")}>{busy ? "…" : "Rotate"}</button>
                      <button onClick={() => setRotating(null)} className={buttonClass("minimal")}>Cancel</button>
                    </div>
                  )}
                </div>
                {!k.revokedAt && manages && (
                  <div className="flex shrink-0 items-center gap-3">
                    {!(k.expiresAt && Date.parse(k.expiresAt) <= Date.now()) && !k.replacedBy && (
                      <button
                        onClick={() => setRotating(rotating === k.id ? null : k.id)}
                        className="text-xs font-medium text-fg-subtle transition-colors hover:text-fg"
                      >
                        Rotate
                      </button>
                    )}
                    <button
                      onClick={() => revoke(k.id)}
                      className="text-xs font-medium text-fg-subtle transition-colors hover:text-red-600"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export function TickButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch("/api/schedule", { method: "POST" });
            const data = await res.json();
            setResult(
              data.fired?.length ? `fired: ${data.fired.join(", ")}` : "nothing due right now",
            );
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        className={buttonClass("secondary")}
      >
        {busy ? "Ticking…" : "Run scheduler now"}
      </button>
      {result && <span className="text-xs text-fg-muted">{result}</span>}
    </div>
  );
}
