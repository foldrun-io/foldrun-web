"use client";

// The forms for what a scope's AGENTS.md sets by default: a timezone for
// its schedules, a budget over a day, week or month, where to notify. One card each, on the
// same SettingsForm, posting to the scope's PATCH. A workspace shows what
// it would inherit from the account beside each empty field.

import { useEffect, useState } from "react";
import { SettingsForm, Field, useSettingsForm } from "./settings-form";
import { inputClass, selectClass } from "./ui";
import { WithEmails } from "./email";
import { NOTIFY_EVENTS, DEPLOY_BLOCKS, type Defaults, type Notify, type Budget, type Alerts, type Judge } from "./defaults-model";

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
    <SettingsForm form={form} hint="timezone: in AGENTS.md">
      <Field label="Timezone" help={inherited && !form.value ? `Empty — schedules here use ${inherited}, the account's.` : "Schedules written here fire in this zone unless the flow names its own."}>
        <input
          list="foldrun-zones"
          value={form.value}
          onChange={(e) => form.setValue(e.target.value)}
          placeholder={inherited ?? "UTC"}
          className={inputClass("w-full max-w-sm font-mono")}
        />
        {zones.length > 0 && (
          <datalist id="foldrun-zones">
            {zones.map((z) => <option key={z} value={z} />)}
          </datalist>
        )}
      </Field>
    </SettingsForm>
  );
}

const PERIODS = [
  { value: "day", label: "a day", window: "today" },
  { value: "week", label: "a week", window: "this week" },
  { value: "month", label: "a month", window: "this month" },
] as const;

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
            <input
              type="number"
              min={0}
              step={1}
              value={form.value.usd}
              onChange={(e) => form.setValue({ ...form.value, usd: e.target.value })}
              placeholder="no limit"
              className={inputClass("w-full pl-6")}
            />
          </div>
          <span className="text-sm text-fg-muted">per</span>
          <select
            value={form.value.period}
            onChange={(e) => form.setValue({ ...form.value, period: e.target.value as Budget["period"] })}
            className={selectClass("w-32")}
            aria-label="budget period"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label.replace(/^a /, "")}
              </option>
            ))}
          </select>
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
    <SettingsForm form={form} hint="budget: in AGENTS.md">
      <Field
        label="Budget (USD)"
        help={
          empty
            ? "No limit — runs start as long as the account has credit."
            : `Runs stop starting once ${period.window}'s spend reaches $${Number(form.value.usd) || 0}; the cap resets with ${period.label}.${spent !== undefined ? ` $${spent.toFixed(2)} spent ${period.window}.` : ""}`
        }
      >
        {control}
      </Field>
    </SettingsForm>
  );
}

export function ConcurrencyCard({ endpoint, tenant, initial, plan }: { endpoint: string; tenant: string; initial: number | null; plan?: number | null }) {
  const form = useSettingsForm(initial === null ? "" : String(initial), async (v) => {
    const d = await patch(endpoint, tenant, { concurrency: v.trim() === "" ? null : Number(v) });
    return d.concurrency === null ? "" : String(d.concurrency);
  });
  return (
    <SettingsForm form={form} hint="concurrency: in AGENTS.md">
      <Field
        label="Runs at once"
        help={form.value.trim() === "" ? (plan ? `Empty — the plan's ${plan} at a time.` : "No cap — as many as the install can drive.") : `At most ${Number(form.value) || 0} runs drive at the same time; the rest wait their turn in the queue, never refused.`}
      >
        <input type="number" min={1} max={64} step={1} value={form.value} onChange={(e) => form.setValue(e.target.value)} placeholder="plan" className={inputClass("max-w-[8rem]")} />
      </Field>
    </SettingsForm>
  );
}

/** owner: — governance. Who answers for every agent and flow here that names none. */
export function OwnerCard({ endpoint, tenant, initial, inherited }: { endpoint: string; tenant: string; initial: string | null; inherited?: string | null }) {
  const form = useSettingsForm(initial ?? "", async (v) => {
    const d = await patch(endpoint, tenant, { owner: v.trim() || null });
    return d.owner ?? "";
  });
  return (
    <SettingsForm form={form} hint="owner: in AGENTS.md (governance)">
      <Field
        label="Owner"
        help={form.value.trim() ? "Shown on every agent and flow here that names no owner of its own, and on its traces." : inherited ? <WithEmails text={`Empty — the account's owner, ${inherited}.`} /> : "Empty — nobody named. Each agent's own owner: still shows."}
      >
        <input value={form.value} onChange={(e) => form.setValue(e.target.value)} placeholder="ops@example.com" maxLength={200} className={inputClass("max-w-sm")} />
      </Field>
    </SettingsForm>
  );
}

const ALERT_FIELDS: { key: Exclude<keyof Alerts, "new_host">; label: string; placeholder: string; help: string }[] = [
  { key: "failure_rate", label: "Failure rate", placeholder: "30%", help: "of the runs that finished in a day" },
  { key: "min_runs", label: "…once at least", placeholder: "5", help: "runs have finished" },
  { key: "credits_day", label: "Credits in a day", placeholder: "2000", help: "charged in the last 24 hours" },
  { key: "run_minutes", label: "A run going after", placeholder: "45", help: "minutes" },
  { key: "stale_days", label: "An agent idle for", placeholder: "30", help: "days" },
  { key: "cost_spike", label: "A run costing", placeholder: "3", help: "× its flow's average this week" },
  { key: "runs_per_hour", label: "One flow started", placeholder: "20", help: "times in an hour" },
];

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
    <SettingsForm form={form} hint="alerts: in AGENTS.md (observability) — each one told to notify: as an alert">
      {workspace && (
        <Field label="Thresholds" help={own ? "Set here, these replace the account's thresholds whole — an empty set means no alerts for this workspace." : "The account's thresholds apply here."}>
          <select value={own ? "own" : "account"} onChange={(e) => form.setValue({ ...form.value, own: e.target.value === "own" })} className={selectClass("max-w-[14rem]")}>
            <option value="account">the account&apos;s</option>
            <option value="own">this workspace&apos;s own</option>
          </select>
        </Field>
      )}
      {own && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ALERT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} help={f.help}>
              <input
                value={String(form.value[f.key] ?? "")}
                onChange={(e) => form.setValue({ ...form.value, [f.key]: e.target.value })}
                placeholder={inherited?.[f.key] !== undefined ? `account: ${String(inherited[f.key])}` : f.placeholder}
                className={inputClass("max-w-[10rem]")}
              />
            </Field>
          ))}
          <Field label="A new site" help={`an agent reached a site it never reached before${inherited?.new_host ? " (on for the account)" : ""}`}>
            <input type="checkbox" checked={form.value.new_host === true} onChange={(e) => form.setValue({ ...form.value, new_host: e.target.checked })} />
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
  const from = inherited?.model ? `the account's, ${inherited.model}` : "the fast tier";
  return (
    <SettingsForm form={form} hint="judge: in AGENTS.md (evaluation)">
      <div className="flex flex-wrap gap-3">
        <Field label="Judges grade with" help={form.value.model ? "Every judge: in an eval and every verify: judge: here. An eval that names its own model: keeps it." : `Unset — ${from}.`}>
          <select value={form.value.model} onChange={(e) => form.setValue({ ...form.value, model: e.target.value })} className={selectClass("max-w-[12rem]")}>
            <option value="">{inherited?.model ? `the account's (${inherited.model})` : "fast (default)"}</option>
            <option value="fast">fast</option>
            <option value="default">default</option>
            <option value="max">max</option>
            {/* An alias or a model id written in AGENTS.md is shown as itself, so a save keeps it. */}
            {form.value.model && !["fast", "default", "max"].includes(form.value.model) && <option value={form.value.model}>{form.value.model}</option>}
          </select>
        </Field>
        <Field label="Effort" help="how long a judge thinks">
          <select value={form.value.effort} onChange={(e) => form.setValue({ ...form.value, effort: e.target.value })} className={selectClass("max-w-[10rem]")}>
            <option value="">{inherited?.effort ? `the account's (${inherited.effort})` : "the model's default"}</option>
            {["low", "medium", "high", "xhigh", "max"].map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </Field>
      </div>
    </SettingsForm>
  );
}

const BLOCK_HELP: Record<(typeof DEPLOY_BLOCKS)[number], string> = {
  none: "Security findings are warnings: the deploy goes ahead and says so.",
  secrets: "A deploy that carries a key or password written into a file is refused.",
  security: "A deploy with any security finding is refused — a written-in key, hidden or injected text, the lethal trifecta, curl | sh, an unpinned MCP server, a step that acts outside unchecked.",
};

/** deploy_block: (FOL-58). A foldrun-ignore with a reason still accepts one finding. */
export function DeployBlockCard({ endpoint, tenant, initial }: { endpoint: string; tenant: string; initial: (typeof DEPLOY_BLOCKS)[number] | null }) {
  const form = useSettingsForm<string>(initial ?? "none", async (v) => {
    const d = await patch(endpoint, tenant, { deploy_block: v === "none" ? null : v });
    return d.deployBlock ?? "none";
  });
  const value = form.value as (typeof DEPLOY_BLOCKS)[number];
  return (
    <SettingsForm form={form} hint="deploy_block: in AGENTS.md">
      <Field label="Refuse a deploy on" help={`${BLOCK_HELP[value] ?? ""} A workspace's own AGENTS.md can say otherwise.`}>
        <select value={value} onChange={(e) => form.setValue(e.target.value)} className={selectClass("max-w-[14rem]")}>
          <option value="none">nothing — warn only</option>
          <option value="secrets">a written-in secret</option>
          <option value="security">any security finding</option>
        </select>
      </Field>
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
    <SettingsForm form={form} hint="network_enforce: in AGENTS.md">
      <Field
        label="A site off an agent's network: list"
        help={
          inherited
            ? "The account refuses already, so every step here is refused too. Only the account's setting can turn it off."
            : form.value === "refuse"
              ? "Refused: the step gets a 403 and the trace says which site. Add it to the agent's network: list to allow it."
              : "Allowed, and named once in the run's trace — so you can see what your agents reach before you start refusing. (An install that refuses for everyone still refuses.)"
        }
      >
        <select value={form.value} onChange={(e) => form.setValue(e.target.value)} className={selectClass("max-w-[14rem]")} disabled={inherited}>
          <option value="report">allowed — report only</option>
          <option value="refuse">refused</option>
        </select>
      </Field>
    </SettingsForm>
  );
}

const EVENT_LABEL: Record<(typeof NOTIFY_EVENTS)[number], string> = {
  failed: "a run fails",
  "awaiting-approval": "a run waits for approval",
  completed: "a run completes",
};

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
  const inheritedLine = inherited ? [inherited.email, inherited.url].filter(Boolean).join(" and ") : null;

  return (
    <SettingsForm form={form} hint="notify: in AGENTS.md">
      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 rounded border-line-strong" />
        {v.enabled ? "Notifications set here" : inheritedLine ? `Inherit the account's: ${inheritedLine}` : "No notifications"}
      </label>
      {scopeNote && <p className="text-xs text-fg-subtle">{scopeNote}</p>}
      {v.enabled && (
        <>
          <Field label="Email" help="Sent through the account's RESEND_API_KEY connection.">
            <input type="email" value={v.email ?? ""} onChange={(e) => set({ email: e.target.value })} placeholder="ops@example.com" className={inputClass("w-full max-w-sm")} />
          </Field>
          <Field label="Webhook URL" help="Slack, Discord, ntfy, any relay — a URL, or the name of a secret that holds one, as ${SLACK_WEBHOOK_URL}.">
            <input value={v.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="${SLACK_WEBHOOK_URL}" className={inputClass("w-full font-mono")} />
          </Field>
          <fieldset>
            <legend className="block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Notify when</legend>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              {NOTIFY_EVENTS.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <input type="checkbox" checked={v.events.includes(e)} onChange={() => toggleEvent(e)} className="h-4 w-4 rounded border-line-strong" />
                  {EVENT_LABEL[e]}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-fg-subtle">Completed is opt-in: a channel that pings on every success gets muted, which un-pings the failures too.</p>
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
        `/api/workspaces/${encodeURIComponent(workspace)}/notify/test${tenant !== "default" ? `?tenant=${tenant}` : ""}`,
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
    <div className="border-t border-line-faint pt-3">
      <button
        type="button"
        onClick={send}
        disabled={state.busy}
        className="rounded border border-line px-3 py-1.5 text-sm font-medium text-fg-secondary hover:border-line-strong hover:bg-sunken disabled:opacity-50"
      >
        {state.busy ? "Sending…" : "Send a test notification"}
      </button>
      <p className="mt-1 text-xs text-fg-subtle">
        Sends one real message to this destination now. Saved settings only — save first if you have just edited them.
      </p>
      {state.result && (
        <p className={`mt-2 text-sm ${state.result.ok ? "text-emerald-700" : "text-red-600"}`}>
          {state.result.ok ? "Delivered to" : "Failed for"} <span className="font-mono text-xs">{state.result.destination}</span>
          {" — "}
          {state.result.detail}
        </p>
      )}
    </div>
  );
}
