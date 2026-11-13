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
  /** FOL-168: its runs and gateway calls must name an end customer. */
  requireCustomer?: boolean;
  /** "a2a": an outside agent's key — it opens /a2a only, for `a2a.flows`. */
  purpose?: "a2a" | "gateway";
  /** "gateway": a coding agent's key — its own spending limits, and what it
   *  has spent in all and today (UTC), USD. */
  gateway?: { capUsd: number | null; dailyUsd: number | null; spentUsd?: number; todayUsd?: number; credential?: "login"; plan?: "pro" | "max"; models?: { opus?: string; sonnet?: string; haiku?: string } };
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

type Kind = "api" | "a2a" | "gateway";
const usd = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;

// Claude Code's status line for a gateway key: its spend, from the gateway's
// GET /v1/usage. Claude Code hands the command the env it runs on, so the
// curl form reads the same two settings the key was set with.
const STATUS_LINE_SETTING = `"statusLine": { "type": "command", "command": "foldrun gateway status-line" }`;
const STATUS_LINE_CURL = `curl -s -m 3 -H "authorization: Bearer $ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_BASE_URL/v1/usage?format=line"`;

/** A gateway key's limits and spend, in one line. */
function gatewaySpend(g: NonNullable<KeyRow["gateway"]>): string {
  const parts: string[] = [];
  if (g.capUsd !== null) parts.push(`${usd(g.spentUsd)} of ${usd(g.capUsd)}`);
  else parts.push(`${usd(g.spentUsd)} spent`);
  if (g.dailyUsd !== null) parts.push(`${usd(g.todayUsd)} of ${usd(g.dailyUsd)} today`);
  return parts.join(" · ");
}

const TIERS = ["opus", "sonnet", "haiku"] as const;
const TIER_LABEL = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" } as const;

/** What a gateway key's Claude Code tiers run on, in one line; null when
 *  every tier runs as Claude Code names it. */
function modelsLine(m: NonNullable<KeyRow["gateway"]>["models"]): string | null {
  const parts = TIERS.filter((t) => m?.[t]).map((t) => `${TIER_LABEL[t]} → ${m![t]}`);
  return parts.length ? parts.join(" · ") : null;
}

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
  gateway = null,
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
  /** Gateway keys, where offered (an admin of every workspace, on the
   *  hosted platform): the URL a coding agent is pointed at, or null when
   *  none is set yet. */
  gateway?: { url: string | null; login?: boolean } | null;
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
  // FOL-168: every run / gateway call with the key must name an end customer.
  const [requireCust, setRequireCust] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const manages = useCan("keys:manage");
  const [created, setCreated] = useState<string | null>(null);
  // An A2A key (1 Nov 2026): one workspace, the flows it may call, how many
  // tasks it may have open — instead of a role and workspaces.
  const [kind, setKind] = useState<Kind>("api");
  const [createdKind, setCreatedKind] = useState<Kind>("api");
  // A gateway key (10 Nov 2026): what it may spend, in all and per day.
  const [capUsd, setCapUsd] = useState("20");
  const [dailyUsd, setDailyUsd] = useState("");
  // Where a gateway key's calls run: foldrun's models (billed, with limits)
  // or, for the operator's own accounts, the operator's Claude login.
  const [runsOn, setRunsOn] = useState<"models" | "login">("models");
  const [plan, setPlan] = useState<"pro" | "max">("pro");
  const onLogin = kind === "gateway" && runsOn === "login" && gateway?.login === true;
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
            : kind === "gateway"
              ? onLogin
                ? { tenant, label, expires, purpose: "gateway", credential: "login", plan, ...(requireCust ? { requireCustomer: true } : {}) }
                : { tenant, label, expires, purpose: "gateway", ...(capUsd.trim() ? { capUsd: Number(capUsd) } : {}), ...(dailyUsd.trim() ? { dailyUsd: Number(dailyUsd) } : {}), ...(requireCust ? { requireCustomer: true } : {}) }
              : { tenant, label, role, expires, ...(narrow ? { workspaces: chosen } : {}), ...(requireCust ? { requireCustomer: true } : {}) },
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

  // A gateway key's model map (Part A5): which model each Claude Code tier
  // runs on for that key.
  const [editingModels, setEditingModels] = useState<string | null>(null);
  // What went wrong with one key's Models or Rotate, shown under that key's
  // panel — not in the "Create a key" card at the top, off-screen on a phone.
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [modelDraft, setModelDraft] = useState<{ opus: string; sonnet: string; haiku: string }>({ opus: "", sonnet: "", haiku: "" });
  const saveModels = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setRowError(null);
    try {
      const picked = Object.fromEntries(TIERS.filter((t) => modelDraft[t].trim()).map((t) => [t, modelDraft[t].trim()]));
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ models: Object.keys(picked).length ? picked : null }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingModels(null);
        router.refresh();
      } else setRowError({ id, message: data.error ?? "failed to save the models" });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : "failed to save the models" });
    } finally {
      setBusy(false);
    }
  };

  const toggleRequireCustomer = async (id: string, on: boolean) => {
    if (busy) return;
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requireCustomer: on }) });
      const data = await res.json();
      if (res.ok) router.refresh();
      else setRowError({ id, message: data.error ?? "failed to change it" });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : "failed to change it" });
    } finally {
      setBusy(false);
    }
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
        const was = keys.find((k) => k.id === id)?.purpose;
        setCreatedKind(was === "a2a" || was === "gateway" ? was : "api");
        setRotating(null);
        router.refresh();
      } else setRowError({ id, message: data.error ?? "failed to rotate the key" });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : "failed to rotate the key" });
    } finally {
      setBusy(false);
    }
  };

  const createDisabled =
    busy || (kind === "api" ? narrow && chosen.length === 0 : kind === "gateway" ? !onLogin && !capUsd.trim() && !dailyUsd.trim() : !a2aWs || a2aChosen.length === 0);
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
            hint={
              kind === "a2a"
                ? "Opens /a2a only — every /api route refuses it."
                : kind === "gateway"
                  ? "Opens the gateway only — every /api route refuses it."
                  : "Shown once. Copy it when it appears."
            }
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
                  <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full" aria-label="What the key is for">
                    <option value="api">API key</option>
                    <option value="a2a">A2A key — an outside agent</option>
                    {gateway && <option value="gateway">Gateway key — Claude Code</option>}
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

              {kind === "gateway" && gateway && (
                <div className="space-y-3 rounded-md border border-line bg-sunken p-4 text-sm text-fg-muted">
                  {/* A coding agent's key: Claude Code (or any tool that takes
                      an Anthropic base URL and key) spends the account's
                      credits on foldrun's models through the
                      gateway, up to the limits set here. No /api route. */}
                  {gateway.login && (
                    <Field label="Runs on">
                      <Select value={runsOn} onChange={(e) => setRunsOn(e.target.value as "models" | "login")} className="w-full max-w-md" aria-label="What the key's calls run on">
                        <option value="models">foldrun&apos;s models — billed, with limits</option>
                        <option value="login">This account&apos;s plan — not billed per call</option>
                      </Select>
                    </Field>
                  )}
                  {onLogin && (
                    <Field label="Size">
                      <Select value={plan} onChange={(e) => setPlan(e.target.value as "pro" | "max")} className="w-full max-w-md" aria-label="The key's size">
                        <option value="pro">Pro</option>
                        <option value="max">Max — five times Pro&apos;s usage limits</option>
                      </Select>
                    </Field>
                  )}
                  {onLogin ? (
                    <p>Claude Code runs on this account&apos;s plan. Its calls are not billed one by one, so it takes no dollar limit; the plan&apos;s own usage limits apply. Claude models only. It opens nothing else: every /api route refuses it.</p>
                  ) : (
                    <p>A gateway key lets Claude Code use foldrun&apos;s models (Claude, and any other model on the price list, picked by name) on this account&apos;s credits, up to the limits below. It opens nothing else: every /api route refuses it.</p>
                  )}
                  {!onLogin && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Spending limit, USD">
                      <Input type="number" min={0.01} step={0.01} value={capUsd} onChange={(e) => setCapUsd(e.target.value)} placeholder="none" className="w-full" aria-label="The most the key may spend in all, USD" />
                    </Field>
                    <Field label="Daily limit, USD (UTC day)">
                      <Input type="number" min={0.01} step={0.01} value={dailyUsd} onChange={(e) => setDailyUsd(e.target.value)} placeholder="none" className="w-full" aria-label="The most the key may spend per UTC day, USD" />
                    </Field>
                  </div>
                  )}
                  {!onLogin && <p>Set at least one. Each call is held at its most it could cost, so a call that would pass a limit is refused before it is sent.</p>}
                </div>
              )}

              {kind !== "a2a" && (
                <div className="text-sm text-fg-muted">
                  {/* FOL-168: a partner's guard — nothing this key does slips past
                      its per-customer limits by leaving the customer out. */}
                  <label className="inline-flex items-center gap-2 text-fg">
                    <Checkbox checked={requireCust} onCheckedChange={(checked: boolean) => setRequireCust(checked)} />
                    Require a customer id
                  </label>
                  <p className="mt-1">
                    {kind === "gateway"
                      ? "Every call must send x-foldrun-customer, naming which of your users it is for; a call without one is refused."
                      : "Every run it starts must name a customer — which of your users it is for; a run without one is refused."}
                  </p>
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
          {createdKind === "gateway" ? (
            <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">
              {`export ANTHROPIC_BASE_URL=${gateway?.url ?? "<not set on this platform yet>"}\nexport ANTHROPIC_AUTH_TOKEN=${created.slice(0, 12)}…`}
            </pre>
          ) : (
            <p className="mt-2 font-mono text-xs leading-relaxed text-fg-secondary">
              export {createdKind === "a2a" ? "FOLDRUN_A2A_KEY" : "FOLDRUN_TOKEN"}={created.slice(0, 12)}…
            </p>
          )}
          {createdKind === "gateway" && <p className="mt-1 text-xs text-fg-secondary">Set both, then run claude. It opens the gateway only.</p>}
          {createdKind === "gateway" && (
            <>
              <p className="mt-3 text-xs text-fg-secondary">To see the key&apos;s spend under Claude Code&apos;s input box, add this to ~/.claude/settings.json (foldrun CLI 20.11 or later):</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">{STATUS_LINE_SETTING}</pre>
              <p className="mt-1 text-xs text-fg-secondary">Without the foldrun CLI, use this command instead:</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">{STATUS_LINE_CURL}</pre>
            </>
          )}
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
                  <li key={k.id} className={cn("flex min-w-0 flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-3 sm:px-5", (k.revokedAt || expired) && "opacity-70")}>
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
                        ) : k.purpose === "gateway" ? (
                          <Tag>
                            <Tooltip label="A coding agent's key (Claude Code): it spends the account's credits on foldrun's models through the gateway, up to its own limits, and opens no /api route"><span>gateway</span></Tooltip>
                          </Tag>
                        ) : (
                          <Tag>
                            <Tooltip label={k.role ? "What this key may do" : "Minted before roles existed — acts as admin"}><span>{k.role ?? "admin"}</span></Tooltip>
                          </Tag>
                        )}
                        {k.requireCustomer && !k.revokedAt && (
                          <Tooltip label={k.purpose === "gateway" ? "Every call must send x-foldrun-customer — a call without one is refused" : "Every run it starts must name a customer — a run without one is refused"}>
                            <span>
                              <Chip>customer required</Chip>
                            </span>
                          </Tooltip>
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
                        {k.purpose === "gateway" && k.gateway?.credential === "login" && (
                          <Tooltip label="Runs on this account's plan: not billed per call, and the plan's usage limits apply">
                            <span>{k.gateway.plan === "max" ? "Max" : "Pro"} plan · not billed per call</span>
                          </Tooltip>
                        )}
                        {k.purpose === "gateway" && modelsLine(k.gateway?.models) && (
                          <Tooltip label="What Claude Code's tiers run on with this key: picking one in /model sends it here">
                            <span>{modelsLine(k.gateway?.models)}</span>
                          </Tooltip>
                        )}
                        {k.purpose === "gateway" && k.gateway && k.gateway.credential !== "login" && (
                          <Tooltip label="What it has spent against its limits; calls in flight count at their estimate">
                            <span>{gatewaySpend(k.gateway)}</span>
                          </Tooltip>
                        )}
                        {!k.scope && k.purpose !== "a2a" && k.purpose !== "gateway" && (
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
                        {k.purpose !== "a2a" && !k.revokedAt && (
                          <div>
                            <dt className="inline text-fg-subtle">Customer </dt>
                            <dd className="inline">
                              {k.requireCustomer ? "required" : "not required"}
                              {!scoped && (
                                <button type="button" disabled={busy} onClick={() => void toggleRequireCustomer(k.id, !k.requireCustomer)} className="ml-2 text-fg-secondary underline decoration-line underline-offset-2 hover:text-fg">
                                  {k.requireCustomer ? "stop requiring" : "require"}
                                </button>
                              )}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="inline text-fg-subtle">Expires </dt>
                          <dd className="inline">{k.expiresAt ? <LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} /> : "never"}</dd>
                        </div>
                        <div className="font-mono text-fg-subtle">
                          {k.prefix}… · {k.id}
                        </div>
                      </dl>
                      {editingModels === k.id && (
                        <div className="mt-3 space-y-3 rounded-md border border-line bg-sunken p-3 text-sm">
                          <p className="text-fg-muted">
                            Which model Claude Code&apos;s tiers run on with this key. Leave one empty to run it as Claude Code names it. A model is written as <span className="font-mono">openai/gpt-6</span>, <span className="font-mono">deepseek/deepseek-v4</span>, <span className="font-mono">zai/glm-5.3</span>, <span className="font-mono">qwen/qwen3.8-max</span> or <span className="font-mono">gemini/…</span> (also <span className="font-mono">kimi/</span>, <span className="font-mono">minimax/</span>, <span className="font-mono">mimo/</span>)
                            {k.gateway?.credential === "login" ? " — this key runs on the plan, so Claude models only." : "; it must be on foldrun's price list."}
                          </p>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {TIERS.map((t) => (
                              <Field key={t} label={TIER_LABEL[t]}>
                                <Input value={modelDraft[t]} onChange={(e) => setModelDraft((d) => ({ ...d, [t]: e.target.value }))} placeholder="as named" className="w-full font-mono" aria-label={`Model for ${TIER_LABEL[t]}`} />
                              </Field>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="primary" onClick={() => void saveModels(k.id)} disabled={busy}>
                              {busy ? "Saving…" : "Save"}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingModels(null);
                                setRowError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      {rotating === k.id && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken p-3 text-sm">
                          <span className="text-fg-muted">{k.purpose === "gateway" ? "A new key with this label and limits (its spend starts afresh) —" : "A new key with this label, role and workspaces —"}</span>
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
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRotating(null);
                              setRowError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      {rowError?.id === k.id && (editingModels === k.id || rotating === k.id) && (
                        <p role="alert" className="mt-2 text-sm text-danger">
                          {rowError.message}
                        </p>
                      )}
                    </div>
                    {!k.revokedAt && manages && (
                      <div className="flex shrink-0 items-center gap-1 max-sm:-ml-2.5">
                        {k.purpose === "gateway" && !expired && !k.replacedBy && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (editingModels === k.id) return setEditingModels(null);
                              setModelDraft({ opus: k.gateway?.models?.opus ?? "", sonnet: k.gateway?.models?.sonnet ?? "", haiku: k.gateway?.models?.haiku ?? "" });
                              setEditingModels(k.id);
                            }}
                          >
                            Models
                          </Button>
                        )}
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
