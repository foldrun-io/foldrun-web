"use client";

import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { WithEmails } from "@/components/email";
import { useState } from "react";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Check, Copy, KeyRound, Play } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { SettingsCard, EmptyState, IconBox, Tag, Chip, Field, Callout } from "@foldrun/ui/react/page";
import { cn } from "@foldrun/ui/react/cn";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { useCan } from "@/components/role";
import { ASSIGNABLE, type Role } from "@/platform/permissions";
import { Checkbox } from "@foldrun/ui/react/choice";
import { Tooltip } from "@foldrun/ui/react/tooltip";

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
  /** "a2a": an outside agent's key — it opens /a2a only, for `a2a.flows`. */
  purpose?: "a2a";
  a2a?: { workspace: string; flows: string[]; principal?: string; maxTasks: number };
}

/** The most tasks an A2A key may have open at once (the keys route's bound). */
const A2A_MAX_TASKS = 100;

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
  a2aFlows = {},
}: {
  tenant: string;
  keys: KeyRow[];
  /** Each workspace's flows and whether each is published over A2A — what
   *  an A2A key may be made for. */
  a2aFlows?: Record<string, { name: string; published: boolean }[]>;
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
  // An A2A key (1 Nov 2026): one workspace, the flows it may call, how many
  // tasks it may have open — instead of a role and workspaces.
  const [kind, setKind] = useState<"api" | "a2a">("api");
  const [createdKind, setCreatedKind] = useState<"api" | "a2a">("api");
  const [a2aWs, setA2aWs] = useState<string>(workspaces[0] ?? "");
  const [a2aChosen, setA2aChosen] = useState<string[]>([]);
  const [maxTasks, setMaxTasks] = useState("10");
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
        body: JSON.stringify(
          kind === "a2a"
            ? { tenant, label, expires, purpose: "a2a", workspace: a2aWs, flows: a2aChosen, maxTasks: Number(maxTasks) }
            : { tenant, label, role, expires, ...(narrow ? { workspaces: chosen } : {}) },
        ),
      });
      const data = await res.json();
      if (res.ok) {
        setCreated(data.key);
        setCreatedKind(kind);
        setA2aChosen([]);
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
        setCreatedKind(keys.find((k) => k.id === id)?.purpose === "a2a" ? "a2a" : "api");
        setRotating(null);
        router.refresh();
      } else setError(data.error ?? "failed to rotate the key");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to rotate the key");
    } finally {
      setBusy(false);
    }
  };

  const createDisabled = busy || (kind === "api" ? narrow && chosen.length === 0 : !a2aWs || a2aChosen.length === 0);
  return (
    <div>
      {confirmDialog}
      {manages && (
        // Wraps on a phone: one line of five controls made the whole
        // Settings page wider than the screen (3 Nov 2026).
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <SettingsCard
            id="create-key"
            title="Create a key"
            description="A key is you, on a machine: the CLI and the HTTP API. It carries a role no higher than yours and opens no workspace you cannot."
            hint={kind === "a2a" ? "Opens /a2a only — every /api route refuses it." : "Shown once. Copy it when it appears."}
            footer={
              <Button type="submit" variant="primary" disabled={createDisabled}>
                {busy ? "Creating…" : "Create key"}
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" className="sm:col-span-2">
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop, CI" className="w-full max-w-md" />
                </Field>
                <Field label="Kind">
                  <Select value={kind} onChange={(e) => setKind(e.target.value as "api" | "a2a")} className="w-full" aria-label="What the key is for">
                    <option value="api">API key</option>
                    <option value="a2a">A2A key — an outside agent</option>
                  </Select>
                </Field>
                {/* A key carries a role like a member does. Editor is the default
                    and the right answer for CI; admin is for a key that manages
                    the account and should be rare. */}
                {kind === "api" && (
                  <Field label="Role">
                    <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full" aria-label="Role for the key">
                      {ASSIGNABLE.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Expires">
                  <Select value={expires} onChange={(e) => setExpires(e.target.value)} className="w-full" aria-label="When the key expires">
                    {EXPIRY.map((x) => (
                      <option key={x.v} value={x.v}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {kind === "a2a" && (
                <div className="space-y-3 rounded-md border border-line bg-sunken p-4 text-sm text-fg-muted">
                  {/* An outside agent's key: it opens /a2a/<account>/<workspace>/…
                      for the flows named here (each published with a2a: — a flow
                      not published cannot be chosen, FOL-112), and
                      no /api route — not runs, approvals, source or keys. */}
                  <p>An A2A key lets an outside agent call published flows of one workspace over A2A — nothing else: every /api route refuses it, and it can never approve a gate or answer a question.</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-fg">
                      Workspace
                      <Select
                        value={a2aWs}
                        onChange={(e) => {
                          setA2aWs(e.target.value);
                          setA2aChosen([]);
                        }}
                                                aria-label="The workspace whose flows the A2A key may call"
                      >
                        {workspaces.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Tooltip label="How many of its tasks may be open at once; one more is refused until one ends">
                      <label className="inline-flex items-center gap-2 text-fg">
                        Open tasks at most
                        <Input type="number" min={1} max={A2A_MAX_TASKS} value={maxTasks} onChange={(e) => setMaxTasks(e.target.value)} className="w-20" />
                      </label>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {(a2aFlows[a2aWs] ?? []).map((f) => (
                      <Tooltip
                        key={f.name}
                        label={f.published ? "Published over A2A" : "Not published — publish it first (the flow's Publish over A2A control); a key names published flows only"}
                      >
                        <label className="inline-flex items-center gap-1.5 font-mono text-fg-secondary">
                          <Checkbox
                            disabled={!f.published}
                            checked={a2aChosen.includes(f.name)}
                            onCheckedChange={(checked: boolean) => setA2aChosen((c) => (checked ? [...c, f.name] : c.filter((x) => x !== f.name)))}
                          />
                          {f.name}
                          {!f.published && <span className="font-sans text-fg-subtle">(not published)</span>}
                        </label>
                      </Tooltip>
                    ))}
                    {(a2aFlows[a2aWs] ?? []).length === 0 && <span>No flows in this workspace.</span>}
                  </div>
                </div>
              )}

              {kind === "api" && (
                <div className="text-sm text-fg-muted">
                  {/* What the key will be able to reach, said before it exists. A
                      key is never more than its minter: a role at or below yours,
                      and only workspaces you can open. */}
                  <label className="inline-flex items-center gap-2 text-fg">
                    <Checkbox checked={narrow} onCheckedChange={(checked: boolean) => setNarrow(checked)} />
                    Limit to some workspaces
                  </label>
                  {!narrow && (
                    <p className="mt-1">
                      The key will open {scoped ? `the ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"} you can open` : "every workspace"}, at the role you pick — never above your own.
                    </p>
                  )}
                  {narrow && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                      {workspaces.map((w) => (
                        <label key={w} className="inline-flex items-center gap-1.5 font-mono text-fg-secondary">
                          <Checkbox checked={chosen.includes(w)} onCheckedChange={(checked: boolean) => setChosen((c) => (checked ? [...c, w] : c.filter((x) => x !== w)))} />
                          {w}
                        </label>
                      ))}
                      {workspaces.length === 0 && <span>No workspaces yet.</span>}
                    </div>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
          </SettingsCard>
        </form>
      )}
      {!manages && error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      {created && (
        <Callout tone="success" className="mb-6 p-4 sm:p-5" role="status">
          <p className="text-sm font-medium text-success">Key created — copy it now, it won&apos;t be shown again.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-fg">{created}</code>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(created);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
          <p className="mt-2 font-mono text-xs leading-relaxed text-fg-secondary">
            export {createdKind === "a2a" ? "FOLDRUN_A2A_KEY" : "FOLDRUN_TOKEN"}={created.slice(0, 12)}…
          </p>
          {createdKind === "a2a" && <p className="mt-1 text-xs text-fg-secondary">Give it to the outside agent; it sends it as Authorization: Bearer to /a2a only.</p>}
        </Callout>
      )}

      <section className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-2 px-1">
          <h2 className="text-base font-medium text-fg">Keys</h2>
          <span className="text-sm tabular-nums text-fg-muted">{keys.length}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {keys.length === 0 ? (
            <EmptyState bare compact icon={<KeyRound />} title="No keys yet" description="Create one to authenticate the CLI and API." />
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((k) => {
                const expired = !!k.expiresAt && Date.parse(k.expiresAt) <= Date.now();
                const next = k.replacedBy ? keys.find((n) => n.id === k.replacedBy) : undefined;
                return (
                  <li key={k.id} className={cn("flex min-w-0 items-start gap-3 px-4 py-3.5 sm:px-5", (k.revokedAt || expired) && "opacity-70")}>
                    <IconBox className="mt-0.5 max-sm:hidden">
                      <KeyRound />
                    </IconBox>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                        <span className="mr-0.5 truncate">{k.label}</span>
                        {k.purpose === "a2a" ? (
                          <Tag>
                            <Tooltip label="An outside agent's key: it opens /a2a only — the published flows it names — and no /api route"><span>A2A</span></Tooltip>
                          </Tag>
                        ) : (
                          <Tag>
                            <Tooltip label={k.role ? "What this key may do" : "Minted before roles existed — acts as admin"}><span>{k.role ?? "admin"}</span></Tooltip>
                          </Tag>
                        )}
                        {k.revokedAt && <Chip tone="bad">revoked</Chip>}
                        {!k.revokedAt && expired && <Chip tone="bad">expired</Chip>}
                        {!k.revokedAt && k.origin !== "cli-login" && k.expiresAt && !expired && Date.parse(k.expiresAt) - Date.now() < 7 * 86_400_000 && (
                          <Chip tone="warn">expires {relative(k.expiresAt)}</Chip>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-fg-muted">
                        {k.purpose === "a2a" && k.a2a && (
                          <Tooltip label={`The flows this key may call in ${k.a2a.workspace}, each also published; at most ${k.a2a.maxTasks} tasks open at once`}>
                            <span>
                              {k.a2a.workspace}: {k.a2a.flows.join(", ")} · {k.a2a.maxTasks} open
                            </span>
                          </Tooltip>
                        )}
                        {k.scope && (
                          <Tooltip label="A deploy key, for the platform's own git — which went on 17 Oct 2026, so it opens nothing now. Revoke it.">
                            <span className="text-warning">deploy key · opens nothing · revoke</span>
                          </Tooltip>
                        )}
                        {!k.scope && k.purpose !== "a2a" && (
                          <Tooltip label={k.workspaces ? "The workspaces this key opens — its minter's at the time, or fewer" : "Every workspace in the account"}>
                            <span>{k.workspaces ? (k.workspaces.length === 0 ? "no workspaces" : k.workspaces.join(", ")) : "all workspaces"}</span>
                          </Tooltip>
                        )}
                        {k.origin === "cli-login" && !k.revokedAt && (
                          <Tooltip label="Minted by foldrun login on that machine. It lasts 90 days and the CLI renews it while the machine is in use; revoke it to sign that machine out."><span>CLI sign-in · renews itself</span></Tooltip>
                        )}
                        {k.replacedBy && (
                          <Tooltip label="Rotated: this key is not rotated again — rotate the new one (also if its secret was lost)">
                            <span>rotated → {next ? `${next.label} · ${next.prefix}…` : k.replacedBy}</span>
                          </Tooltip>
                        )}
                      </p>
                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
                        <div>
                          <dt className="inline text-fg-subtle">Created </dt>
                          <dd className="inline">
                            <LocalTime iso={k.createdAt} options={{ dateStyle: "medium" }} />
                            {k.createdBy ? (
                              <>
                                {" "}
                                by <WithEmails text={k.createdBy} />
                              </>
                            ) : (
                              ""
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-fg-subtle">Last used </dt>
                          <dd className="inline">
                            {k.lastUsedAt ? (
                              <>
                                {relative(k.lastUsedAt)}
                                {k.lastIp ? <span className="font-mono text-fg-subtle"> · {k.lastIp}</span> : null}
                              </>
                            ) : (
                              "never"
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-fg-subtle">Expires </dt>
                          <dd className="inline">{k.expiresAt ? <LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} /> : "never"}</dd>
                        </div>
                        <div className="font-mono text-fg-subtle">
                          {k.prefix}… · {k.id}
                        </div>
                      </dl>
                      {rotating === k.id && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken p-3 text-sm">
                          <span className="text-fg-muted">A new key with this label, role and workspaces —</span>
                          <Select value={grace} onChange={(e) => setGrace(e.target.value)} size="sm" aria-label="What happens to the old key">
                            {GRACE.map((g) => (
                              <option key={g.v} value={g.v}>
                                {g.label}
                              </option>
                            ))}
                          </Select>
                          <Button variant="primary" onClick={() => void rotate(k.id)} disabled={busy}>
                            {busy ? "Rotating…" : "Rotate"}
                          </Button>
                          <Button variant="ghost" onClick={() => setRotating(null)}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                    {!k.revokedAt && manages && (
                      <div className="flex shrink-0 items-center gap-1">
                        {!expired && !k.replacedBy && (
                          <Button variant="ghost" size="sm" onClick={() => setRotating(rotating === k.id ? null : k.id)}>
                            Rotate
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="hover:text-danger" onClick={() => revoke(k.id)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export function TickButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {result && <span className="text-sm text-fg-muted">{result}</span>}
      <Button
        variant="secondary"
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
      >
        <Play aria-hidden />
        {busy ? "Ticking…" : "Run scheduler now"}
      </Button>
    </div>
  );
}
