"use client";

import { labelOf, ROLE_LABEL } from "@/components/value-labels";
import { $el, $rich, $t } from "@/i18n";
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
  { v: "30d", label: $t("settings.keys.30Days") },
  { v: "90d", label: $t("settings.keys.90Days") },
  { v: "365d", label: $t("settings.keys.1Year") },
  { v: "never", label: $t("settings.keys.neverExpires") },
];
const GRACE = [
  { v: "0", label: $t("settings.keys.revokeTheOldKeyNow") },
  { v: "1h", label: $t("settings.keys.keepTheOldKey1Hour") },
  { v: "24h", label: $t("settings.keys.keepTheOldKey24Hours") },
];

type Kind = "api" | "a2a" | "gateway";
const usd = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;

// Claude Code's status line for a gateway key: its spend, from the gateway's
// GET /v1/usage. Claude Code hands the command the env it runs on, so the
// curl form reads the same two settings the key was set with.
const STATUS_LINE_SETTING = $t("settings.keys.statuslineTypeCommandCommandFoldrunGateway");
const STATUS_LINE_CURL = `curl -s -m 3 -H "authorization: Bearer $ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_BASE_URL/v1/usage?format=line"`;

/** A gateway key's limits and spend, in one line. */
function gatewaySpend(g: NonNullable<KeyRow["gateway"]>): string {
  const parts: string[] = [];
  if (g.capUsd !== null) parts.push($t("settings.keys.spentOfCap", { spent: usd(g.spentUsd), cap: usd(g.capUsd) }));
  else parts.push($t("settings.keys.spent", { spent: usd(g.spentUsd) }));
  if (g.dailyUsd !== null) parts.push($t("settings.keys.ofToday", { v0: String(usd(g.todayUsd)), v1: String(usd(g.dailyUsd)) }));
  return parts.join(" · ");
}

const TIERS = ["opus", "sonnet", "haiku"] as const;
const TIER_LABEL = { opus: $t("settings.keys.opus"), sonnet: $t("settings.keys.sonnet"), haiku: $t("settings.keys.haiku") } as const;

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
  return $t("settings.keys.relative", { n, unit, past: d < 0 ? "yes" : "no" });
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
        setError(data.error ?? $t("settings.keys.failedToCreateKey"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : $t("settings.keys.failedToCreateKey"));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!(await confirm({
      title: $t("settings.keys.revokeThisKey"),
      body: $t("settings.keys.clientsUsingItStopWorkingImmediately"),
      confirmLabel: $t("settings.keys.revoke"),
    }))) return;
    await fetch("/api/keys", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant, id }),
    });
    router.refresh();
  };

  // Delete (17 Nov 2026): a live key is revoked in the same moment; a revoked
  // or expired one just leaves the list. The audit log keeps the record.
  const remove = async (id: string, live: boolean) => {
    if (!(await confirm({
      title: $t("settings.keys.deleteThisKey"),
      body: live ? $t("settings.keys.deleteLiveKeyBody") : $t("settings.keys.deleteRevokedKeyBody"),
      confirmLabel: $t("settings.keys.delete"),
    }))) return;
    setRowError(null);
    const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setRowError({ id, message: body.error ?? $t("settings.keys.couldNotDeleteKey") });
      return;
    }
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
      } else setRowError({ id, message: data.error ?? $t("settings.keys.failedToSaveTheModels") });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : $t("settings.keys.failedToSaveTheModels") });
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
      else setRowError({ id, message: data.error ?? $t("settings.keys.failedToChangeIt") });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : $t("settings.keys.failedToChangeIt") });
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
      } else setRowError({ id, message: data.error ?? $t("settings.keys.failedToRotateTheKey") });
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : $t("settings.keys.failedToRotateTheKey") });
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
            title={$t("settings.keys.createAKey")}
            description={$t("settings.keys.aKeyIsYouOnA")}
            hint={
              kind === "a2a"
                ? $t("settings.keys.opensA2aOnlyEveryApiRoute")
                : kind === "gateway"
                  ? $t("settings.keys.opensTheGatewayOnlyEveryApi")
                  : $t("settings.keys.shownOnceCopyItWhenIt")
            }
            footer={
              <Button type="submit" variant="primary" disabled={createDisabled}>
                {busy ? $t("settings.keys.creating") : $t("settings.keys.createKey")}
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={$t("settings.keys.name")} className="sm:col-span-2">
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={$t("settings.keys.laptopCi")} className="w-full max-w-md" />
                </Field>
                <Field label={$t("settings.keys.kind")}>
                  <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full" aria-label={$t("settings.keys.whatTheKeyIsFor")}>
                    <option value="api">{$t("settings.keys.apiKey")}</option>
                    <option value="a2a">{$t("settings.keys.a2aKeyAnOutsideAgent")}</option>
                    {gateway && <option value="gateway">{$t("settings.keys.gatewayKeyClaudeCode")}</option>}
                  </Select>
                </Field>
                {/* A key carries a role like a member does. Editor is the default
                    and the right answer for CI; admin is for a key that manages
                    the account and should be rare. */}
                {kind === "api" && (
                  <Field label={$t("settings.keys.role")}>
                    <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full" aria-label={$t("settings.keys.roleForTheKey")}>
                      {ASSIGNABLE.map((r) => (
                        <option key={r} value={r}>
                          {labelOf(ROLE_LABEL, r)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label={$t("settings.keys.expires")}>
                  <Select value={expires} onChange={(e) => setExpires(e.target.value)} className="w-full" aria-label={$t("settings.keys.whenTheKeyExpires")}>
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
                  <p>{$t("settings.keys.anA2aKeyLetsAnOutside")}</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-fg">
                      {$t("settings.keys.workspace")}
                      <Select
                        value={a2aWs}
                        onChange={(e) => {
                          setA2aWs(e.target.value);
                          setA2aChosen([]);
                        }}
                                                aria-label={$t("settings.keys.theWorkspaceWhoseFlowsTheA2a")}
                      >
                        {workspaces.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Tooltip label={$t("settings.keys.howManyOfItsTasksMay")}>
                      <label className="inline-flex items-center gap-2 text-fg">
                        {$rich("settings.keys.openTasksAtMost", { input: $el(<Input type="number" min={1} max={A2A_MAX_TASKS} value={maxTasks} onChange={(e) => setMaxTasks(e.target.value)} className="w-20" />) })}
                      </label>
                    </Tooltip>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {(a2aFlows[a2aWs] ?? []).map((f) => (
                      <Tooltip
                        key={f.name}
                        label={f.published ? $t("settings.keys.publishedOverA2a") : $t("settings.keys.notPublishedPublishItFirstThe")}
                      >
                        <label className="inline-flex items-center gap-1.5 font-mono text-fg-secondary">
                          <Checkbox
                            disabled={!f.published}
                            checked={a2aChosen.includes(f.name)}
                            onCheckedChange={(checked: boolean) => setA2aChosen((c) => (checked ? [...c, f.name] : c.filter((x) => x !== f.name)))}
                          />
                          {f.name}
                          {!f.published && <span className="font-sans text-fg-subtle">{$t("settings.keys.notPublished")}</span>}
                        </label>
                      </Tooltip>
                    ))}
                    {(a2aFlows[a2aWs] ?? []).length === 0 && <span>{$t("settings.keys.noFlowsInThisWorkspace")}</span>}
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
                    <Field label={$t("settings.keys.runsOn")}>
                      <Select value={runsOn} onChange={(e) => setRunsOn(e.target.value as "models" | "login")} className="w-full max-w-md" aria-label={$t("settings.keys.whatTheKeySCallsRun")}>
                        <option value="models">{$t("settings.keys.foldrunSModelsBilledWithLimits")}</option>
                        <option value="login">{$t("settings.keys.thisAccountSPlanNotBilled")}</option>
                      </Select>
                    </Field>
                  )}
                  {onLogin && (
                    <Field label={$t("settings.keys.size")}>
                      <Select value={plan} onChange={(e) => setPlan(e.target.value as "pro" | "max")} className="w-full max-w-md" aria-label={$t("settings.keys.theKeySSize")}>
                        <option value="pro">{$t("settings.keys.pro")}</option>
                        <option value="max">{$t("settings.keys.maxFiveTimesProSUsage")}</option>
                      </Select>
                    </Field>
                  )}
                  {onLogin ? (
                    <p>{$t("settings.keys.claudeCodeRunsOnThisAccount")}</p>
                  ) : (
                    <p>{$t("settings.keys.aGatewayKeyLetsClaudeCode")}</p>
                  )}
                  {!onLogin && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={$t("settings.keys.spendingLimitUsd")}>
                      <Input type="number" min={0.01} step={0.01} value={capUsd} onChange={(e) => setCapUsd(e.target.value)} placeholder="none" className="w-full" aria-label={$t("settings.keys.theMostTheKeyMaySpend")} />
                    </Field>
                    <Field label={$t("settings.keys.dailyLimitUsdUtcDay")}>
                      <Input type="number" min={0.01} step={0.01} value={dailyUsd} onChange={(e) => setDailyUsd(e.target.value)} placeholder="none" className="w-full" aria-label={$t("settings.keys.theMostTheKeyMaySpend2")} />
                    </Field>
                  </div>
                  )}
                  {!onLogin && <p>{$t("settings.keys.setAtLeastOneEachCall")}</p>}
                </div>
              )}

              {kind !== "a2a" && (
                <div className="text-sm text-fg-muted">
                  {/* FOL-168: a partner's guard — nothing this key does slips past
                      its per-customer limits by leaving the customer out. */}
                  <label className="inline-flex items-center gap-2 text-fg">
                    {$rich("settings.keys.requireACustomerId", { checkbox: $el(<Checkbox checked={requireCust} onCheckedChange={(checked: boolean) => setRequireCust(checked)} />) })}
                  </label>
                  <p className="mt-1">
                    {kind === "gateway"
                      ? $t("settings.keys.everyCallMustSendXFoldrun")
                      : $t("settings.keys.everyRunItStartsMustName")}
                  </p>
                </div>
              )}
              {kind === "api" && (
                <div className="text-sm text-fg-muted">
                  {/* What the key will be able to reach, said before it exists. A
                      key is never more than its minter: a role at or below yours,
                      and only workspaces you can open. */}
                  <label className="inline-flex items-center gap-2 text-fg">
                    {$rich("settings.keys.limitToSomeTerm", { checkbox: $el(<Checkbox checked={narrow} onCheckedChange={(checked: boolean) => setNarrow(checked)} />) })}
                  </label>
                  {!narrow && (
                    <p className="mt-1">
                      {scoped ? $t("settings.keys.keyOpensScoped", { n: workspaces.length }) : $t("settings.keys.keyOpensAll")}
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
                      {workspaces.length === 0 && <span>{$t("settings.keys.noWorkspaceYet")}</span>}
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
          <p className="text-sm font-medium text-success">{$t("settings.keys.keyCreatedCopyItNowIt")}</p>
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
              {copied ? $t("settings.keys.copied") : $t("settings.keys.copy")}
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              {$t("settings.keys.done")}
            </Button>
          </div>
          {createdKind === "gateway" ? (
            <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">
              {`export ANTHROPIC_BASE_URL=${gateway?.url ?? "<not set on this platform yet>"}\nexport ANTHROPIC_AUTH_TOKEN=${created.slice(0, 12)}…`}
            </pre>
          ) : (
            <p className="mt-2 font-mono text-xs leading-relaxed text-fg-secondary">
              {$t("settings.keys.export")}{" "}{createdKind === "a2a" ? "FOLDRUN_A2A_KEY" : "FOLDRUN_TOKEN"}={created.slice(0, 12)}…
            </p>
          )}
          {createdKind === "gateway" && <p className="mt-1 text-xs text-fg-secondary">{$t("settings.keys.setBothThenRunClaudeIt")}</p>}
          {createdKind === "gateway" && (
            <>
              <p className="mt-3 text-xs text-fg-secondary">{$t("settings.keys.toSeeTheKeySInput")}</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">{STATUS_LINE_SETTING}</pre>
              <p className="mt-1 text-xs text-fg-secondary">{$t("settings.keys.withoutTheFoldrunCliUseThis")}</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-relaxed text-fg-secondary">{STATUS_LINE_CURL}</pre>
            </>
          )}
          {createdKind === "a2a" && <p className="mt-1 text-xs text-fg-secondary">{$t("settings.keys.giveItToTheOutsideAgent")}</p>}
        </Callout>
      )}

      <section className="min-w-0 space-y-3">
        <div className="flex items-end justify-between gap-2 px-1">
          <h2 className="text-base font-medium text-fg">{$t("settings.keys.keys")}</h2>
          <span className="text-sm tabular-nums text-fg-muted">{keys.length}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {keys.length === 0 ? (
            <EmptyState bare compact icon={<KeyRound />} title={$t("settings.keys.noKeysYet")} description={$t("settings.keys.createOneToAuthenticateTheCli")} />
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
                            <Tooltip label={$t("settings.keys.anOutsideAgentSKeyIt")}><span>A2A</span></Tooltip>
                          </Tag>
                        ) : k.purpose === "gateway" ? (
                          <Tag>
                            <Tooltip label={$t("settings.keys.aCodingAgentSCreditsOn")}><span>{$t("settings.keys.gateway")}</span></Tooltip>
                          </Tag>
                        ) : (
                          <Tag>
                            <Tooltip label={k.role ? $t("settings.keys.whatThisKeyMayDo") : $t("settings.keys.mintedBeforeRolesExistedActsAs")}><span>{labelOf(ROLE_LABEL, k.role ?? "admin")}</span></Tooltip>
                          </Tag>
                        )}
                        {k.requireCustomer && !k.revokedAt && (
                          <Tooltip label={k.purpose === "gateway" ? $t("settings.keys.everyCallMustSendXFoldrun2") : $t("settings.keys.everyRunItStartsMustName2")}>
                            <span>
                              <Chip>{$t("settings.keys.customerRequired")}</Chip>
                            </span>
                          </Tooltip>
                        )}
                        {k.revokedAt && <Chip tone="bad">{$t("settings.keys.revoked")}</Chip>}
                        {!k.revokedAt && expired && <Chip tone="bad">{$t("settings.keys.expired")}</Chip>}
                        {!k.revokedAt && k.origin !== "cli-login" && k.expiresAt && !expired && Date.parse(k.expiresAt) - Date.now() < 7 * 86_400_000 && (
                          <Chip tone="warn">{$t("settings.keys.expires2", { relative: relative(k.expiresAt) })}</Chip>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-fg-muted">
                        {k.purpose === "a2a" && k.a2a && (
                          <Tooltip label={$t("settings.keys.theFlowsThisKeyMayCall", { workspace: String(k.a2a.workspace), maxTasks: String(k.a2a.maxTasks) })}>
                            <span>
                              {$t("settings.keys.open", { workspace: k.a2a.workspace, join: k.a2a.flows.join(", "), maxTasks: String(k.a2a.maxTasks) })}
                            </span>
                          </Tooltip>
                        )}
                        {k.scope && (
                          <Tooltip label={$t("settings.keys.aDeployKeyForThePlatform")}>
                            <span className="text-warning">{$t("settings.keys.deployKeyOpensNothingRevoke")}</span>
                          </Tooltip>
                        )}
                        {k.purpose === "gateway" && k.gateway?.credential === "login" && (
                          <Tooltip label={$t("settings.keys.runsOnThisAccountSUsage")}>
                            <span>{$t("settings.keys.planNotBilled", { plan: k.gateway.plan === "max" ? "max" : "pro" })}</span>
                          </Tooltip>
                        )}
                        {k.purpose === "gateway" && modelsLine(k.gateway?.models) && (
                          <Tooltip label={$t("settings.keys.whatClaudeCodeSTiersRun")}>
                            <span>{modelsLine(k.gateway?.models)}</span>
                          </Tooltip>
                        )}
                        {k.purpose === "gateway" && k.gateway && k.gateway.credential !== "login" && (
                          <Tooltip label={$t("settings.keys.whatItHasSpentAgainstIts")}>
                            <span>{gatewaySpend(k.gateway)}</span>
                          </Tooltip>
                        )}
                        {!k.scope && k.purpose !== "a2a" && k.purpose !== "gateway" && (
                          <Tooltip label={k.workspaces ? $t("settings.keys.theWorkspaceThisKeyOpensIts") : $t("settings.keys.everyWorkspaceInTheAccount")}>
                            <span>{k.workspaces ? (k.workspaces.length === 0 ? $t("settings.keys.noWorkspace") : k.workspaces.join(", ")) : $t("settings.keys.allWorkspace")}</span>
                          </Tooltip>
                        )}
                        {k.origin === "cli-login" && !k.revokedAt && (
                          <Tooltip label={$t("settings.keys.mintedByFoldrunLoginOnThat")}><span>{$t("settings.keys.cliSignInRenewsItself")}</span></Tooltip>
                        )}
                        {k.replacedBy && (
                          <Tooltip label={$t("settings.keys.rotatedThisKeyIsNotRotated")}>
                            <span>{$t("settings.keys.rotated")}{" "}{next ? `${next.label} · ${next.prefix}…` : $t("settings.keys.aDeletedKey")}</span>
                          </Tooltip>
                        )}
                      </p>
                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
                        <div>
                          <dt className="inline text-fg-subtle">{$t("settings.keys.created")}{" "}</dt>
                          <dd className="inline">
                            <LocalTime iso={k.createdAt} options={{ dateStyle: "medium" }} />
                            {k.createdBy ? (
                              <>
                                {" "}{$rich("settings.keys.by", { withEmails: $el(<WithEmails text={k.createdBy} />) })}
                              </>
                            ) : (
                              ""
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-fg-subtle">{$t("settings.keys.lastUsed")}{" "}</dt>
                          <dd className="inline">
                            {k.lastUsedAt ? (
                              <>
                                {relative(k.lastUsedAt)}
                                {k.lastIp ? <span className="font-mono text-fg-subtle"> · {k.lastIp}</span> : null}
                              </>
                            ) : (
                              $t("settings.keys.never")
                            )}
                          </dd>
                        </div>
                        {k.purpose !== "a2a" && !k.revokedAt && (
                          <div>
                            <dt className="inline text-fg-subtle">{$t("settings.keys.customer")}{" "}</dt>
                            <dd className="inline">
                              {k.requireCustomer ? "required" : $t("settings.keys.notRequired")}
                              {!scoped && (
                                <button type="button" disabled={busy} onClick={() => void toggleRequireCustomer(k.id, !k.requireCustomer)} className="ml-2 text-fg-secondary underline decoration-line underline-offset-2 hover:text-fg">
                                  {k.requireCustomer ? $t("settings.keys.stopRequiring") : "require"}
                                </button>
                              )}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="inline text-fg-subtle">{$t("settings.keys.expires")}{" "}</dt>
                          <dd className="inline">{k.expiresAt ? <LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} /> : $t("settings.keys.never")}</dd>
                        </div>
                        <div className="font-mono text-fg-subtle">
                          {k.prefix}… · {k.id}
                        </div>
                      </dl>
                      {editingModels === k.id && (
                        <div className="mt-3 space-y-3 rounded-md border border-line bg-sunken p-3 text-sm">
                          <p className="text-fg-muted">
                            {$rich("settings.keys.whichModelClaudeCodeSTiers", { span: (chunks) => <span className="font-mono">{chunks}</span> })}
                            {k.gateway?.credential === "login" ? $t("settings.keys.thisKeyRunsOnThePlan") : $t("settings.keys.itMustBeOnFoldrunS")}
                          </p>
                          <div className="grid gap-3 sm:grid-cols-3">
                            {TIERS.map((t) => (
                              <Field key={t} label={TIER_LABEL[t]}>
                                <Input value={modelDraft[t]} onChange={(e) => setModelDraft((d) => ({ ...d, [t]: e.target.value }))} placeholder={$t("settings.keys.asNamed")} className="w-full font-mono" aria-label={$t("settings.keys.modelFor", { v0: String(TIER_LABEL[t]) })} />
                              </Field>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="primary" onClick={() => void saveModels(k.id)} disabled={busy}>
                              {busy ? $t("settings.keys.saving") : $t("settings.keys.save")}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEditingModels(null);
                                setRowError(null);
                              }}
                            >
                              {$t("settings.keys.cancel")}
                            </Button>
                          </div>
                        </div>
                      )}
                      {rotating === k.id && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken p-3 text-sm">
                          <span className="text-fg-muted">{k.purpose === "gateway" ? $t("settings.keys.aNewKeyWithThisLabel2") : $t("settings.keys.aNewKeyWithThisLabel")}</span>
                          <Select value={grace} onChange={(e) => setGrace(e.target.value)} size="sm" aria-label={$t("settings.keys.whatHappensToTheOldKey")}>
                            {GRACE.map((g) => (
                              <option key={g.v} value={g.v}>
                                {g.label}
                              </option>
                            ))}
                          </Select>
                          <Button variant="primary" onClick={() => void rotate(k.id)} disabled={busy}>
                            {busy ? $t("settings.keys.rotating") : $t("settings.keys.rotate")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setRotating(null);
                              setRowError(null);
                            }}
                          >
                            {$t("settings.keys.cancel")}
                          </Button>
                        </div>
                      )}
                      {rowError?.id === k.id && (
                        <p role="alert" className="mt-2 text-sm text-danger">
                          {rowError.message}
                        </p>
                      )}
                    </div>
                    {manages && (
                      <div className="flex shrink-0 items-center gap-1 max-sm:-ml-2.5">
                        {!k.revokedAt && k.purpose === "gateway" && !expired && !k.replacedBy && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (editingModels === k.id) return setEditingModels(null);
                              setModelDraft({ opus: k.gateway?.models?.opus ?? "", sonnet: k.gateway?.models?.sonnet ?? "", haiku: k.gateway?.models?.haiku ?? "" });
                              setEditingModels(k.id);
                            }}
                          >
                            {$t("settings.keys.models")}
                          </Button>
                        )}
                        {!k.revokedAt && !expired && !k.replacedBy && (
                          <Button variant="ghost" size="sm" onClick={() => setRotating(rotating === k.id ? null : k.id)}>
                            {$t("settings.keys.rotate")}
                          </Button>
                        )}
                        {!k.revokedAt && (
                          <Button variant="ghost" size="sm" className="hover:text-danger" onClick={() => revoke(k.id)}>
                            {$t("settings.keys.revoke")}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="hover:text-danger" onClick={() => remove(k.id, !k.revokedAt && !expired)}>
                          {$t("settings.keys.delete")}
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
              data.fired?.length ? $t("settings.keys.fired", { list: data.fired.join(", ") }) : $t("settings.keys.nothingDueRightNow"),
            );
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Play aria-hidden />
        {busy ? $t("settings.keys.ticking") : $t("settings.keys.runSchedulerNow")}
      </Button>
    </div>
  );
}
