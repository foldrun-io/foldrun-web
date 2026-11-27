"use client";

// The forms for what a scope's AGENTS.md sets by default: a timezone for
// its schedules, a budget over a day, week or month, where to notify. One card each, on the
// same SettingsForm, posting to the scope's PATCH. A workspace shows what
// it would inherit from the account beside each empty field.

import { $rich, $t, localized } from "@/i18n";
import { useEffect, useState } from "react";
import { SettingsForm, useSettingsForm } from "./settings-form";
import { useHydrated } from "./browser-value";
import { Field } from "@foldrun/ui/react/page";
import { Input } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { WithEmails } from "./email";
import { Button } from "@foldrun/ui/react/button";
import { NOTIFY_EVENTS, DEPLOY_BLOCKS, type Defaults, type Notify, type Budget, type Alerts, type Judge } from "./defaults-model";
import { Switch, Checkbox } from "@foldrun/ui/react/choice";
import { Combobox } from "@foldrun/ui/react/combobox";

async function patch(endpoint: string, tenant: string, body: Record<string, unknown>): Promise<Defaults> {
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data.defaults as Defaults;
}

/** A pool amount, or "any" when the level above sets none. */
const amount = (n: number | null | undefined): string => (n == null ? $t("components.defaults-cards.any") : String(n));

export function TimezoneCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: string | null; inherited?: string | null }) {
  const form = useSettingsForm(initial ?? "", async (tz) => {
    const d = await patch(endpoint, tenant, { timezone: tz.trim() || null });
    return d.timezone ?? "";
  });
  // The browser's zone list, for completion; a typed zone is validated on save.
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
      // Set from a callback, not the effect body: the list is the browser's, read once.
      Promise.resolve(all).then(setZones);
    } catch {
      // no completion, still a text box
    }
  }, []);
  return (
    <SettingsForm
      form={form}
      id="timezone"
      title={$t("components.defaults-cards.timezone")}
      description={inherited && !form.value ? $t("components.defaults-cards.emptySchedulesHereUseTheAccount", { inherited: String(inherited) }) : $t("components.defaults-cards.schedulesWrittenHereFireInThis")}
      hint={<>{$rich("components.defaults-cards.timezoneInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <Combobox
        options={zones}
        aria-label={$t("components.defaults-cards.timezone")}
        value={form.value}
        onChange={(e) => form.setValue(e.target.value)}
        placeholder={inherited ?? "UTC"}
        className="w-full max-w-sm font-mono"
      />
    </SettingsForm>
  );
}

const PERIODS = localized(() => ([
  { value: "day", label: $t("components.defaults-cards.aDay"), window: "today" },
  { value: "week", label: $t("components.defaults-cards.aWeek"), window: $t("components.defaults-cards.thisWeek") },
  { value: "month", label: $t("components.defaults-cards.aMonth"), window: $t("components.defaults-cards.thisMonth") },
] as const));

/** An amount and a period. Empty is no limit — the key is removed, not
 *  written as zero — and the file keeps its old shape for a month (`60`)
 *  while a day or a week says so (`60/day`). */
export function BudgetCard({ endpoint, tenant, initial, spent, compact = false }: { endpoint: string; tenant: string; initial: Budget | null; spent?: number; compact?: boolean }) {
  const form = useSettingsForm(
    { usd: initial ? String(initial.usd) : "", period: initial?.period ?? "month" },
    async (v) => {
      const d = await patch(endpoint, tenant, { budget: v.usd.trim() === "" ? null : { usd: Number(v.usd), period: v.period } });
      return d.budget ? { usd: String(d.budget.usd), period: d.budget.period } : { usd: "", period: v.period };
    },
  );
  const period = PERIODS.find((p) => p.value === form.value.period) ?? PERIODS[2];
  const empty = form.value.usd.trim() === "";
  // Compact drops the label and the help text, because the row this sits in
  // already says the same two things — the old page printed "No limit. Runs
  // start as long as the account has credit." on the left and "No limit —
  // runs start as long as the account has credit." on the right, in the
  // same row, about the same number.
  const control = (
    <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-[10rem]">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-subtle">$</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={form.value.usd}
              onChange={(e) => form.setValue({ ...form.value, usd: e.target.value })}
              placeholder={$t("components.defaults-cards.noLimit")}
              className="w-full pl-6"
            />
          </div>
          <span className="text-sm text-fg-muted">{$t("components.defaults-cards.per")}</span>
          <Select
            value={form.value.period}
            onChange={(e) => form.setValue({ ...form.value, period: e.target.value as Budget["period"] })}
            className="w-32"
            aria-label={$t("components.defaults-cards.budgetPeriod")}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label.replace(/^a /, "")}
              </option>
            ))}
          </Select>
    </div>
  );
  if (compact) {
    return (
      <SettingsForm form={form} compact>
        {control}
      </SettingsForm>
    );
  }
  return (
    <SettingsForm
      form={form}
      id="budget"
      title={$t("components.defaults-cards.budget")}
      description={
        empty
          ? $t("components.defaults-cards.noLimitRunsStartAsLong")
          : $t("components.defaults-cards.runsStopStartingOnceSSpend", { window: String(period.window), v1: String(Number(form.value.usd) || 0), label: String(period.label), v3: String(spent !== undefined ? $t("components.defaults-cards.spent", { v0: String(spent.toFixed(2)), window: String(period.window) }) : "") })
      }
      hint={<>{$rich("components.defaults-cards.budgetInAgentsMdInUsd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      {control}
    </SettingsForm>
  );
}

export function ConcurrencyCard({ endpoint, tenant, initial, plan }: { endpoint: string; tenant: string; initial: number | null; plan?: number | null }) {
  const form = useSettingsForm(initial === null ? "" : String(initial), async (v) => {
    const d = await patch(endpoint, tenant, { concurrency: v.trim() === "" ? null : Number(v) });
    return d.concurrency === null ? "" : String(d.concurrency);
  });
  return (
    <SettingsForm
      form={form}
      id="concurrency"
      title={$t("components.defaults-cards.runsAtOnce")}
      description={form.value.trim() === "" ? (plan ? $t("components.defaults-cards.emptyThePlanSAtA", { plan: String(plan) }) : $t("components.defaults-cards.noCapAsManyAsThe")) : $t("components.defaults-cards.atMostRunsDriveAtThe", { v0: String(Number(form.value) || 0) })}
      hint={<>{$rich("components.defaults-cards.concurrencyInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <Input type="number" min={1} max={64} step={1} aria-label={$t("components.defaults-cards.runsAtOnce")} value={form.value} onChange={(e) => form.setValue(e.target.value)} placeholder="plan" className="max-w-[8rem]" />
    </SettingsForm>
  );
}

/** A step waiting for room to start (GET /v1/account/usage/compute `waiting`). */
export type RoomWaitRow = { workspace: string; runId: string; flow: string; step: number; agent: string; since: string; why: string; cpus: number; memGiB: number; diskGiB?: number; level?: string };

/** What a level's running steps hold (GET /v1/account/usage/compute). */
export type HeldRow = { vcpu: number; memGiB: number; diskGiB?: number; steps: number };
/** The figures a level allows; null is no cap at that level. */
export type PoolRow = { vcpu: number | null; memGiB: number | null; diskGiB?: number | null; stepVcpu?: number | null; stepMemGiB?: number | null; stepDiskGiB?: number | null; source?: string | null; stepDefault?: string[] };
/** The account's runs waiting for their turn and the most before a new one
 *  is refused (GET /v1/account/usage/compute `runsWaiting`, FOL-100). */
export type RunsWaitingRow = { waiting: number | null; limit: number | null };

const LEVEL_WORDS = localized(() => ({
  account: { own: $t("components.defaults-cards.yourOwnCap"), help: $t("components.defaults-cards.coresGibAndDiskAllYour") },
  workspace: { own: $t("components.defaults-cards.thisWorkspaceSCap"), help: $t("components.defaults-cards.coresGibAndDiskTheSteps") },
  flow: { own: $t("components.defaults-cards.eachRunSCap"), help: $t("components.defaults-cards.coresGibAndDiskOneRun") },
} as const));

/** compute: at one level (27 Oct 2026) — the account's pool (the plan's,
 *  the install's, or its own lower `compute:`), a workspace's, or each
 *  run's of a flow: what its running steps hold now against it, the steps
 *  waiting for room, and its own cap to set. Cores, memory and disk. */
export function ComputeCard({
  endpoint,
  tenant,
  initial,
  pool,
  inUse,
  waiting = [],
  runsWaiting,
  level = "account",
  outer,
}: {
  endpoint: string;
  tenant: string;
  initial: Defaults["compute"];
  pool: PoolRow;
  inUse: HeldRow;
  waiting?: RoomWaitRow[];
  /** The account's: shown on the account level only. */
  runsWaiting?: RunsWaitingRow;
  /** Which level this card sets. */
  level?: "account" | "workspace" | "flow";
  /** The account's pool, shown beside a narrower level's own. */
  outer?: PoolRow;
}) {
  const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  // The pool and what is held, as the server last said: refetched after a
  // save, so a lowered cap shows as the figure now enforced.
  // `at`: the browser's clock when they were read, for "waiting 3 min".
  const [live, setLive] = useState(() => ({ pool, inUse, waiting, runsWaiting, at: Date.now() }));
  // That figure is shown only after hydration, never rendered on the server
  // — the two clocks would disagree (Codex review).
  const now = useHydrated() ? live.at : null;
  const form = useSettingsForm({ vcpu: str(initial?.vcpu), memGiB: str(initial?.memGiB), diskGiB: str(initial?.diskGiB) }, async (v) => {
    const blank = v.vcpu.trim() === "" && v.memGiB.trim() === "" && v.diskGiB.trim() === "";
    const res0 = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ compute: blank ? null : { vcpu: v.vcpu.trim() || null, memGiB: v.memGiB.trim() || null, diskGiB: v.diskGiB.trim() || null } }),
    });
    const d = (await res0.json().catch(() => ({}))) as { error?: string; defaults?: Defaults; flow?: { compute?: Defaults["compute"] } };
    if (!res0.ok) throw new Error(d.error ?? `${res0.status}`);
    if (level === "account") {
      const res = await fetch("/v1/account/usage/compute", { headers: { "x-foldrun-tenant": tenant } }).catch(() => null);
      const fresh = res && res.ok ? ((await res.json().catch(() => null)) as { compute?: PoolRow; inUse?: HeldRow; waiting?: RoomWaitRow[]; runsWaiting?: RunsWaitingRow } | null) : null;
      if (fresh?.compute && fresh.inUse) setLive({ pool: fresh.compute, inUse: fresh.inUse, waiting: fresh.waiting ?? [], runsWaiting: fresh.runsWaiting ?? runsWaiting, at: Date.now() });
    }
    // The flow route answers the flow; the settings routes, the defaults.
    const c = (d.defaults?.compute ?? d.flow?.compute ?? null) as Defaults["compute"] | null;
    if (level !== "account") setLive((l) => ({ ...l, pool: { vcpu: c?.vcpu ?? null, memGiB: c?.memGiB ?? null, diskGiB: c?.diskGiB ?? null } }));
    return { vcpu: str(c?.vcpu), memGiB: str(c?.memGiB), diskGiB: str(c?.diskGiB) };
  });
  const of = (used: number, cap: number | null | undefined, unit: string) => (cap === null || cap === undefined ? $t("components.defaults-cards.noCap", { used: String(used), unit: String(unit) }) : $t("components.defaults-cards.usedOfCap", { used: String(used), cap: String(cap), unit }));
  const from = live.pool.source === "plan" ? $t("components.defaults-cards.thePlanS") : live.pool.source === "account" ? $t("components.defaults-cards.yourOwnBelow") : live.pool.source === "install" ? $t("components.defaults-cards.thisInstallS") : null;
  const words = LEVEL_WORDS[level];
  return (
    <SettingsForm
      form={form}
      id="compute"
      title={$t("components.defaults-cards.compute")}
      description={$t("components.defaults-cards.whatRunningStepsHoldNowAnd")}
      hint={<><code className="font-mono text-xs">compute:</code> {level === "flow" ? $t("components.defaults-cards.inTheFlow") : $t("components.defaults-cards.inAgentsMd")}</>}
    >
      <div className="grid gap-1 text-sm text-fg-secondary">
        <span>
          {$t("components.defaults-cards.heldByRunningStep", { steps: live.inUse.steps })}{" "}<span className="tabular-nums text-fg">{of(live.inUse.vcpu, live.pool.vcpu, "vCPU")}</span> ·{" "}
          <span className="tabular-nums text-fg">{of(live.inUse.memGiB, live.pool.memGiB, "GiB")}</span> ·{" "}
          <span className="tabular-nums text-fg">{of(live.inUse.diskGiB ?? 0, live.pool.diskGiB, $t("components.defaults-cards.gibDisk"))}</span>
          {from ? <span className="text-fg-muted"> — {from}</span> : null}
        </span>
        {outer && (
          <span className="text-fg-muted">
            {$t("components.defaults-cards.accountAllowsPool", { vcpu: amount(outer.vcpu), mem: amount(outer.memGiB), disk: amount(outer.diskGiB) })}
          </span>
        )}
        {(live.pool.stepVcpu || live.pool.stepMemGiB || live.pool.stepDiskGiB) && (
          <span className="text-fg-muted">
            {$t("components.defaults-cards.oneStepMayHold", { vcpu: amount(live.pool.stepVcpu), mem: amount(live.pool.stepMemGiB), disk: amount(live.pool.stepDiskGiB), fallback: live.pool.stepDefault?.length ? "yes" : "no" })}
          </span>
        )}
        {level === "account" && live.runsWaiting && live.runsWaiting.limit !== null && (
          <span className="text-fg-muted">
            {live.runsWaiting.waiting !== null ? (
              <>
                {$rich("components.defaults-cards.ofRunsWaitingForTheirTurn", { waiting: String(live.runsWaiting.waiting), limit: String(live.runsWaiting.limit), span: (chunks) => <span className="tabular-nums text-fg">{chunks}</span> })}
              </>
            ) : (
              <>{$rich("components.defaults-cards.upToRunsMayWaitFor", { limit: String(live.runsWaiting.limit), span: (chunks) => <span className="tabular-nums text-fg">{chunks}</span> })}</>
            )}
            {" "}{$t("components.defaults-cards.whileWaitANewRunIs", { limit: String(live.runsWaiting.limit) })}
          </span>
        )}
        {live.waiting.length > 0 && (
          <div className="grid gap-0.5">
            <span>
              {$t("components.defaults-cards.stepWaitingForRoomEachStarts", { length: live.waiting.length })}
            </span>
            <ul className="grid gap-0.5 text-xs text-fg-muted">
              {live.waiting.slice(0, 5).map((w) => (
                <li key={`${w.runId}-${w.step}`} className="truncate">
                  <a href={`/dashboard/${encodeURIComponent(w.workspace)}/runs/${encodeURIComponent(w.runId)}${tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : ""}`} className="text-fg-muted hover:text-fg hover:underline">
                    {w.flow} · {w.agent}
                  </a>{" "}
                  <span className="tabular-nums">
                    {$t("components.defaults-cards.vcpuGib", { cpus: String(w.cpus), memGiB: String(w.memGiB) })}{w.diskGiB ? $t("components.defaults-cards.gibDisk2", { diskGiB: String(w.diskGiB) }) : ""}{now !== null ? `, ${waitedFor(w.since, now)}` : ""}
                  </span>{" "}
                  — {w.why}
                </li>
              ))}
              {live.waiting.length > 5 && <li>{$t("components.defaults-cards.andMore", { length: String(live.waiting.length - 5) })}</li>}
            </ul>
          </div>
        )}
      </div>
      <Field label={words.own} hint={words.help}>
        <div className="flex flex-wrap gap-2">
          <Input type="number" min={0.5} step={0.5} value={form.value.vcpu} onChange={(e) => form.setValue({ ...form.value, vcpu: e.target.value })} placeholder="vCPU" aria-label="vCPU" className="max-w-[7rem]" />
          <Input type="number" min={0.25} step={0.25} value={form.value.memGiB} onChange={(e) => form.setValue({ ...form.value, memGiB: e.target.value })} placeholder="GiB" aria-label="GiB" className="max-w-[7rem]" />
          <Input type="number" min={1} step={1} value={form.value.diskGiB} onChange={(e) => form.setValue({ ...form.value, diskGiB: e.target.value })} placeholder={$t("components.defaults-cards.gibDisk")} aria-label={$t("components.defaults-cards.gibDisk")} className="max-w-[7rem]" />
        </div>
      </Field>
    </SettingsForm>
  );
}

/** How long ago a wait began, in words: "waiting 3 min", "waiting 2 h". */
function waitedFor(since: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  return m < 1 ? $t("components.defaults-cards.waitingUnderAMinute") : m < 120 ? $t("components.defaults-cards.waitingMin", { m: String(m) }) : $t("components.defaults-cards.waitingH", { v0: String(Math.round(m / 60)) });
}

/** owner: — governance. Who answers for every agent and flow here that names none. */
export function OwnerCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: string | null; inherited?: string | null }) {
  const form = useSettingsForm(initial ?? "", async (v) => {
    const d = await patch(endpoint, tenant, { owner: v.trim() || null });
    return d.owner ?? "";
  });
  return (
    <SettingsForm
      form={form}
      id="owner"
      title={$t("components.defaults-cards.owner")}
      description={form.value.trim() ? $t("components.defaults-cards.shownOnEveryAgentAndFlow") : inherited ? <WithEmails text={$t("components.defaults-cards.emptyTheAccountSOwner", { inherited: String(inherited) })} /> : $t("components.defaults-cards.emptyNobodyNamedEachAgentS")}
      hint={<>{$rich("components.defaults-cards.ownerInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <Input aria-label={$t("components.defaults-cards.owner")} value={form.value} onChange={(e) => form.setValue(e.target.value)} placeholder="ops@example.com" maxLength={200} className="max-w-sm" />
    </SettingsForm>
  );
}

const ALERT_FIELDS: { key: Exclude<keyof Alerts, "new_host">; label: string; placeholder: string; help: string }[] = localized(() => [
  { key: "failure_rate", label: $t("components.defaults-cards.failureRate"), placeholder: "30%", help: $t("components.defaults-cards.ofTheRunsThatFinishedIn") },
  { key: "min_runs", label: $t("components.defaults-cards.onceAtLeast"), placeholder: "5", help: $t("components.defaults-cards.runsHaveFinished") },
  { key: "credits_day", label: $t("components.defaults-cards.creditsInADay"), placeholder: "2000", help: $t("components.defaults-cards.chargedInTheLast24Hours") },
  { key: "run_minutes", label: $t("components.defaults-cards.aRunGoingAfter"), placeholder: "45", help: "minutes" },
  { key: "stale_days", label: $t("components.defaults-cards.anAgentIdleFor"), placeholder: "30", help: "days" },
  { key: "cost_spike", label: $t("components.defaults-cards.aRunCosting"), placeholder: "3", help: $t("components.defaults-cards.itsFlowSAverageThisWeek") },
  { key: "runs_per_hour", label: $t("components.defaults-cards.oneFlowStarted"), placeholder: "20", help: $t("components.defaults-cards.timesInAnHour") },
]);

/**
 * alerts: — observability. The thresholds that tell notify:, each optional.
 * A workspace either takes the account's thresholds (no block) or sets its
 * own — which replace the account's whole, an empty set meaning "none here".
 */
export function AlertsCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: Alerts | null; inherited?: Alerts | null }) {
  const workspace = inherited !== undefined;
  type Form = Record<string, string | boolean>;
  const toForm = (a: Alerts | null): Form =>
    Object.fromEntries([
      ...ALERT_FIELDS.map((f) => [f.key, a?.[f.key] === undefined ? "" : String(a[f.key])]),
      ["new_host", a?.new_host === true],
      ["own", !workspace || a !== null],
    ]) as Form;
  const form = useSettingsForm<Form>(toForm(initial), async (v) => {
    let alerts: Record<string, string | number | boolean> | null = {};
    if (v.own === false) alerts = null; // the account's
    else {
      for (const f of ALERT_FIELDS) {
        const raw = String(v[f.key] ?? "").trim();
        // A number is sent as one; anything else as written, so the
        // server's parser refuses it by name rather than JSON turning NaN
        // into a null that quietly drops the threshold.
        if (raw) alerts[f.key] = f.key !== "failure_rate" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      }
      if (v.new_host === true) alerts.new_host = true;
      else if (workspace && inherited?.new_host === true) alerts.new_host = false; // off here, though the account has it on
      if (!workspace && !Object.keys(alerts).length) alerts = null;
    }
    const d = await patch(endpoint, tenant, { alerts });
    return toForm(d.alerts);
  });
  const own = form.value.own !== false;
  return (
    <SettingsForm
      form={form}
      id="alerts"
      title={$t("components.defaults-cards.alerts")}
      description={$t("components.defaults-cards.thresholdsThatTellNotifyWhenSomething")}
      hint={<>{$rich("components.defaults-cards.alertsInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      {workspace && (
        <Field label={$t("components.defaults-cards.thresholds")} hint={own ? $t("components.defaults-cards.setHereTheseReplaceTheAccount") : $t("components.defaults-cards.theAccountSThresholdsApplyHere")}>
          <Select value={own ? "own" : "account"} onChange={(e) => form.setValue({ ...form.value, own: e.target.value === "own" })} className="max-w-[14rem]">
            <option value="account">{$t("components.defaults-cards.theAccountS")}</option>
            <option value="own">{$t("components.defaults-cards.thisWorkspaceSOwn")}</option>
          </Select>
        </Field>
      )}
      {own && (
        <div className="grid gap-4 sm:grid-cols-2">
          {ALERT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.help}>
              <Input
                value={String(form.value[f.key] ?? "")}
                onChange={(e) => form.setValue({ ...form.value, [f.key]: e.target.value })}
                placeholder={inherited?.[f.key] !== undefined ? `account: ${String(inherited[f.key])}` : f.placeholder}
                className="max-w-[10rem]"
              />
            </Field>
          ))}
          <Field label={$t("components.defaults-cards.aNewSite")} hint={$t("components.defaults-cards.anAgentReachedASiteIt", { v0: String(inherited?.new_host ? $t("components.defaults-cards.onForTheAccount") : "") })}>
            <Switch checked={form.value.new_host === true} onCheckedChange={(checked: boolean) => form.setValue({ ...form.value, new_host: checked })} />
          </Field>
        </div>
      )}
    </SettingsForm>
  );
}

/** judge: — evaluation. The model every eval and verify: judge: here grades with. */
export function JudgeCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: Judge | null; inherited?: Judge | null }) {
  const form = useSettingsForm<{ model: string; effort: string }>({ model: initial?.model ?? "", effort: initial?.effort ?? "" }, async (v) => {
    const judge = v.model || v.effort ? { ...(v.model ? { model: v.model } : {}), ...(v.effort ? { effort: v.effort } : {}) } : null;
    const d = await patch(endpoint, tenant, { judge });
    return { model: d.judge?.model ?? "", effort: d.judge?.effort ?? "" };
  });
  const from = inherited?.model ? $t("components.defaults-cards.theAccountS2", { model: String(inherited.model) }) : $t("components.defaults-cards.theFastTier");
  return (
    <SettingsForm
      form={form}
      id="judge"
      title={$t("components.defaults-cards.judges")}
      description={$t("components.defaults-cards.theModelEveryJudgeInAn")}
      hint={<>{$rich("components.defaults-cards.judgeInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <div className="flex flex-wrap gap-4">
        <Field label={$t("components.defaults-cards.judgesGradeWith")} hint={form.value.model ? $t("components.defaults-cards.everyJudgeInAnEvalAnd") : $t("components.defaults-cards.unset", { from: String(from) })}>
          <Select value={form.value.model} onChange={(e) => form.setValue({ ...form.value, model: e.target.value })} className="max-w-[12rem]">
            <option value="">{inherited?.model ? $t("components.defaults-cards.theAccountS3", { model: String(inherited.model) }) : $t("components.defaults-cards.fastDefault")}</option>
            <option value="fast">{$t("components.defaults-cards.fast")}</option>
            <option value="default">{$t("components.defaults-cards.default")}</option>
            <option value="max">max</option>
            {/* An alias or a model id written in AGENTS.md is shown as itself, so a save keeps it. */}
            {form.value.model && !["fast", "default", "max"].includes(form.value.model) && <option value={form.value.model}>{form.value.model}</option>}
          </Select>
        </Field>
        <Field label={$t("components.defaults-cards.effort")} hint={$t("components.defaults-cards.howLongAJudgeThinks")}>
          <Select value={form.value.effort} onChange={(e) => form.setValue({ ...form.value, effort: e.target.value })} className="max-w-[10rem]">
            <option value="">{inherited?.effort ? $t("components.defaults-cards.theAccountS4", { effort: String(inherited.effort) }) : $t("components.defaults-cards.theModelSDefault")}</option>
            {["low", "medium", "high", "xhigh", "max"].map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
      </div>
    </SettingsForm>
  );
}

const BLOCK_HELP: Record<(typeof DEPLOY_BLOCKS)[number], string> = localized(() => ({
  none: $t("components.defaults-cards.securityFindingsAreWarningsTheDeploy"),
  secrets: $t("components.defaults-cards.aDeployThatCarriesAKey"),
  security: $t("components.defaults-cards.aDeployWithAnySecurityFinding"),
}));

/** deploy_block: (FOL-58). A foldrun-ignore with a reason still accepts one finding. */
export function DeployBlockCard({ endpoint, tenant, initial }: { endpoint: string; tenant: string; initial: (typeof DEPLOY_BLOCKS)[number] | null }) {
  const form = useSettingsForm<string>(initial ?? "none", async (v) => {
    const d = await patch(endpoint, tenant, { deploy_block: v === "none" ? null : v });
    return d.deployBlock ?? "none";
  });
  const value = form.value as (typeof DEPLOY_BLOCKS)[number];
  return (
    <SettingsForm
      form={form}
      id="deploy-block"
      title={$t("components.defaults-cards.refuseADeployOn")}
      description={$t("components.defaults-cards.aWorkspaceSOwnAgentsMd", { help: String(BLOCK_HELP[value] ?? "") })}
      hint={<>{$rich("components.defaults-cards.deployBlockInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <Select aria-label={$t("components.defaults-cards.refuseADeployOn")} value={value} onChange={(e) => form.setValue(e.target.value)} className="max-w-[14rem]">
        <option value="none">{$t("components.defaults-cards.nothingWarnOnly")}</option>
        <option value="secrets">{$t("components.defaults-cards.aWrittenInSecret")}</option>
        <option value="security">{$t("components.defaults-cards.anySecurityFinding")}</option>
      </Select>
    </SettingsForm>
  );
}

/** network_enforce: — the allowlist refuses instead of only reporting. */
export function NetworkEnforceCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: boolean; inherited?: boolean }) {
  const form = useSettingsForm<string>(initial ? "refuse" : "report", async (v) => {
    const d = await patch(endpoint, tenant, { network_enforce: v === "refuse" });
    return d.networkEnforce ? "refuse" : "report";
  });
  return (
    <SettingsForm
      form={form}
      id="network-enforce"
      title={$t("components.defaults-cards.aSiteOffAnAgentS")}
      description={
        inherited
          ? $t("components.defaults-cards.theAccountRefusesAlreadySoEvery")
          : form.value === "refuse"
            ? $t("components.defaults-cards.refusedTheStepGetsA403")
            : $t("components.defaults-cards.allowedAndNamedOnceInThe")
      }
      hint={<>{$rich("components.defaults-cards.networkEnforceInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <Select aria-label={$t("components.defaults-cards.aSiteOffAnAgentS")} value={form.value} onChange={(e) => form.setValue(e.target.value)} className="max-w-[14rem]" disabled={inherited}>
        <option value="report">{$t("components.defaults-cards.allowedReportOnly")}</option>
        <option value="refuse">{$t("components.defaults-cards.refused")}</option>
      </Select>
    </SettingsForm>
  );
}

const EVENT_LABEL: Record<(typeof NOTIFY_EVENTS)[number], string> = localized(() => ({
  failed: $t("components.defaults-cards.aRunFails"),
  "awaiting-approval": $t("components.defaults-cards.aRunWaitsForApproval"),
  completed: $t("components.defaults-cards.aRunCompletes"),
}));

export function NotifyCard({
  endpoint,
  tenant,
  initial,
  inherited,
  scopeNote,
  testWorkspace,
}: {
  endpoint: string;
  tenant: string;
  initial: Notify | null;
  inherited?: Notify | null;
  scopeNote?: string;
  /** When given, the card offers to send one real message here and report
   *  what happened. Only a workspace can: the account card has no
   *  workspace to send from, and the destination is the same one anyway. */
  testWorkspace?: string;
}) {
  const blank: Notify = { url: "", email: "", events: ["failed", "awaiting-approval"] };
  const form = useSettingsForm<Notify & { enabled: boolean }>(
    { ...blank, ...(initial ?? {}), enabled: initial !== null },
    async (v) => {
      const d = await patch(endpoint, tenant, { notify: v.enabled ? { url: v.url, email: v.email, events: v.events } : null });
      return { ...blank, ...(d.notify ?? {}), enabled: d.notify !== null };
    },
  );
  const v = form.value;
  const set = (p: Partial<typeof v>) => form.setValue({ ...v, ...p });
  const toggleEvent = (e: string) => set({ events: v.events.includes(e) ? v.events.filter((x) => x !== e) : [...v.events, e] });
  const inheritedLine = inherited ? [inherited.email, inherited.url, inherited.hidden ? $t("components.defaults-cards.aWebhook") : null].filter(Boolean).join(" and ") : null;

  return (
    <SettingsForm
      form={form}
      id="notify"
      title={$t("components.defaults-cards.notifications")}
      description={scopeNote ?? $t("components.defaults-cards.whereToSayARunFailed")}
      hint={<>{$rich("components.defaults-cards.notifyInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}
    >
      <label className="flex items-center gap-2 text-sm text-fg">
        <Switch checked={v.enabled} onCheckedChange={(checked: boolean) => set({ enabled: checked })} />
        {v.enabled ? $t("components.defaults-cards.notificationsSetHere") : inheritedLine ? <WithEmails text={$t("components.defaults-cards.inheritTheAccountS", { inheritedLine: String(inheritedLine) })} /> : $t("components.defaults-cards.noNotifications")}
      </label>
      {(initial?.hidden || inherited?.hidden) && (
        <p className="text-xs text-fg-muted">{$t("components.defaults-cards.theAccountSWebhookUrlIs")}</p>
      )}
      {v.enabled && (
        <>
          <Field label={$t("components.defaults-cards.email")} hint={$t("components.defaults-cards.sentThroughTheAccountSResend")}>
            <Input type="email" value={v.email ?? ""} onChange={(e) => set({ email: e.target.value })} placeholder="ops@example.com" className="w-full max-w-sm" />
          </Field>
          <Field label={$t("components.defaults-cards.webhookUrl")} hint={$t("components.defaults-cards.slackDiscordNtfyAnyRelayA")}>
            <Input value={v.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="${SLACK_WEBHOOK_URL}" className="w-full font-mono" />
          </Field>
          <fieldset>
            <legend className="block text-sm font-medium text-fg">{$t("components.defaults-cards.notifyWhen")}</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
              {NOTIFY_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Checkbox checked={v.events.includes(e)} onCheckedChange={() => toggleEvent(e)} />
                  {EVENT_LABEL[e]}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-fg-muted">{$t("components.defaults-cards.completedIsOptInAChannel")}</p>
          </fieldset>
        </>
      )}
      {testWorkspace && (v.enabled || inheritedLine) && <NotifyTest workspace={testWorkspace} tenant={tenant} />}
    </SettingsForm>
  );
}

/**
 * Send one real message and say what came back.
 *
 * Every notification this platform sends goes out when nobody is watching,
 * to a destination nobody has tested. Every run email once spent weeks in a
 * bin and the only symptom was silence, which looks exactly like nothing
 * having gone wrong. This is the button that turns that into a fact.
 *
 * The failure text is the provider's own: "domain not verified" and "you can
 * only send to your own address" send someone to two different pages, and a
 * status code sends them to neither.
 */
function NotifyTest({ workspace, tenant }: { workspace: string; tenant: string }) {
  const [state, setState] = useState<{ busy: boolean; result: { ok: boolean; destination: string; detail: string } | null }>({
    busy: false,
    result: null,
  });

  const send = async () => {
    setState({ busy: true, result: null });
    try {
      const res = await fetch(
        `/v1/workspaces/${encodeURIComponent(workspace)}/notify/test${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
        { method: "POST" },
      );
      const body = await res.json();
      setState({
        busy: false,
        result: res.ok
          ? body
          : { ok: false, destination: "—", detail: body?.error ?? `HTTP ${res.status}` },
      });
    } catch (err) {
      setState({ busy: false, result: { ok: false, destination: "—", detail: err instanceof Error ? err.message : String(err) } });
    }
  };

  return (
    <div className="border-t border-line pt-4">
      <Button type="button" variant="secondary" onClick={send} disabled={state.busy}>
        {state.busy ? $t("components.defaults-cards.sending") : $t("components.defaults-cards.sendATestNotification")}
      </Button>
      <p className="mt-1.5 text-xs text-fg-muted">
        {$t("components.defaults-cards.sendsOneRealMessageToThis")}
      </p>
      {state.result && (
        <p className={`mt-2 text-sm ${state.result.ok ? "text-success" : "text-danger"}`}>
          {state.result.ok ? $t("components.defaults-cards.deliveredTo") : $t("components.defaults-cards.failedFor")} <span className="font-mono text-xs">{state.result.destination}</span>
          {" — "}
          {state.result.detail}
        </p>
      )}
    </div>
  );
}
