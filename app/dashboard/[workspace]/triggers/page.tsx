// Why nothing happened.
//
// Every other page in the dashboard is about runs that exist. This one is
// about the ones that do not, which is the harder question and the one
// support actually gets: "the hook fired and nothing ran."
//
// Every answer to it is a thing that deliberately did not happen — a
// duplicate delivery, a burst still being waited out, a flow switched off
// after a bad week, a schedule the platform slept through. All correct
// behaviour; none of it visible until now. The fix, when there is one, is
// always a key in the flow file, so every row names the key that decided.
//
// Two logs, because they answer two different questions. The trigger log is
// "did an event become a run". The delivery log below it is "did the request
// reach us and was it authentic" — a bad token never gets as far as a flow
// rule, so it appears there and nowhere else. The third, at the bottom, is
// the other direction: the notify: webhooks this workspace sent.

import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listFlows } from "@/lib/store";
import { summariseTriggers, readTriggerEvents, type TriggerOutcome } from "@/lib/trigger-log";
import { readDeliveries } from "@/lib/webhook";
import { WorkspaceHeader } from "@/components/workspace-header";
import { Badge, EmptyScreen, PageHeader, StatCard } from "@/components/ui";
import { DataTable, FilterChips } from "@/components/data";
import { WebhookDeliveries } from "./webhook-deliveries";
import { FilterTest } from "./filter-test";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];


/** What each outcome means in one phrase, and the key that caused it. The
 *  point of the page is that a person can go and change that key. */
const REASON: Record<TriggerOutcome, { label: string; key: string; tone: string }> = {
  started: { label: "started a run", key: "", tone: "text-emerald-700 bg-emerald-50" },
  duplicate: { label: "duplicate delivery", key: "idempotency:", tone: "text-fg-tertiary bg-muted" },
  throttled: { label: "inside the window", key: "throttle:", tone: "text-amber-700 bg-amber-50" },
  debounced: { label: "held for the burst", key: "debounce:", tone: "text-blue-700 bg-blue-50" },
  quarantined: { label: "flow switched off", key: "disable_after:", tone: "text-red-700 bg-red-50" },
  paused: { label: "work is done, paused", key: "pause_when:", tone: "text-emerald-700 bg-emerald-50" },
  halted: { label: "paused by a person", key: "Settings → Governance → Pause", tone: "text-red-700 bg-red-50" },
  "overlap-skipped": { label: "previous run still live", key: "overlap: skip", tone: "text-amber-700 bg-amber-50" },
  missed: { label: "missed while down", key: "catchup: none", tone: "text-amber-700 bg-amber-50" },
  filtered: { label: "did not match the filter", key: "filter:", tone: "text-fg-tertiary bg-muted" },
  failed: { label: "could not start", key: "", tone: "text-red-700 bg-red-50" },
};

const when = (iso: string) => iso.replace("T", " ").slice(0, 19) + "Z";

function Outcome({ outcome }: { outcome: TriggerOutcome }) {
  const r = REASON[outcome] ?? REASON.failed;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${r.tone}`}>{r.label}</span>
  );
}

export default async function TriggersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; since?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", since } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const days = Math.min(Math.max(Number(since) || 7, 1), 365);
  const sinceMs = Date.now() - days * 86400_000;
  const flows = summariseTriggers(tenant, workspace, sinceMs);
  const events = readTriggerEvents(tenant, workspace, 200).filter((e) => new Date(e.t).getTime() >= sinceMs);
  const deliveries = readDeliveries(tenant, workspace, 50);
  const refused = deliveries.filter((d) => d.outcome !== "accepted" && d.outcome !== "dropped");
  // Flows that say which deliveries are theirs (`filter:`), for the Test box.
  let filtered: { name: string; trigger: string; filter: unknown }[] = [];
  try {
    filtered = listFlows(tenant, workspace).filter((f) => f.filter != null).map((f) => ({ name: f.name, trigger: f.trigger, filter: f.filter }));
  } catch {
    /* a workspace whose flows cannot be listed shows no filters */
  }

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const fired = flows.reduce((n, f) => n + f.fired, 0);
  const started = flows.reduce((n, f) => n + f.started, 0);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader
        title="Triggers"
        subtitle={`Every time something tried to start a flow in ${workspace}, and what became of it. The gap between fired and started is the answer to "why did nothing run".`}
      >
        <Link
          href={`/api/workspaces/${workspace}/triggers?since=${days}`}
          className="text-sm font-medium text-fg-muted hover:text-fg"
        >
          As JSON →
        </Link>
      </PageHeader>

      <FilterChips className="mb-4" chips={WINDOWS.map((w) => ({ label: w.label, href: `/dashboard/${workspace}/triggers?since=${w.days}${tenantParam}`, active: w.days === days }))} />

      {fired === 0 && refused.length === 0 ? (
        <EmptyScreen
          title="Nothing has tried to start a flow yet"
          description="Scheduled, webhook, email, storage, watch and chained flows all record here — whether they started a run or were held back by one of the flow's own rules. A workspace of manual flows stays empty, which is correct."
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Triggers fired" value={String(fired)} />
            <StatCard label="Became runs" value={String(started)} />
            <StatCard label="Held back" value={String(fired - started)} />
          </div>

          {flows.length > 0 && (
            <div className="mb-6">
              <DataTable
                title="By flow"
                columns={[{ label: "Flow" }, { label: "Trigger" }, { label: "Fired", align: "right" }, { label: "Ran", align: "right" }, { label: "Held back, and why" }, { label: "Last run" }]}
                rows={flows.map((f) => ({
                  key: f.flow,
                  cells: [
                    <Link href={`/dashboard/${workspace}/flows?flow=${encodeURIComponent(f.flow)}${tenantParam}`} className="font-medium hover:underline">{f.flow}</Link>,
                    <span className="text-fg-muted">{f.trigger}</span>,
                    f.fired,
                    f.started,
                    f.dropped.length === 0 ? <span className="text-fg-subtle">—</span> : (
                      <ul className="space-y-1">
                        {f.dropped.map((d) => (
                          <li key={d.outcome}>
                            <Outcome outcome={d.outcome} /> <span className="text-fg-muted">×{d.count}</span>
                            {REASON[d.outcome]?.key && <code className="ml-1 rounded bg-muted px-1 text-[11px] text-fg-tertiary">{REASON[d.outcome].key}</code>}
                          </li>
                        ))}
                      </ul>
                    ),
                    <span className="whitespace-nowrap text-fg-muted">{f.lastStartedAt ? when(f.lastStartedAt) : <span className="text-fg-subtle">never</span>}</span>,
                  ],
                }))}
                minWidth="min-w-[720px]"
              />
            </div>
          )}

          {events.length > 0 && (
            <div className="mb-6">
              <DataTable
                title="Every decision, newest first"
                columns={[{ label: "When" }, { label: "Flow" }, { label: "Outcome" }, { label: "Detail" }]}
                rows={events.slice(0, 100).map((e, i) => ({
                  key: `${e.t}-${i}`,
                  cells: [<span className="whitespace-nowrap text-fg-muted">{when(e.t)}</span>, <span className="font-medium">{e.flow}</span>, <Outcome outcome={e.outcome} />, <span className="text-fg-tertiary">{e.detail || "—"}</span>],
                }))}
                minWidth="min-w-[720px]"
              />
            </div>
          )}
        </>
      )}

      {/* The flows that only start for some deliveries, and a box to try one.
          A filtered delivery is "did not match the filter" above. */}
      {filtered.length > 0 && (
        <section id="filters" className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-fg">Filters</h2>
          <p className="mb-3 text-sm text-fg-muted">
            A flow with <code className="text-xs">filter:</code> starts only for deliveries whose fields match it — anything else is held back before it counts toward idempotency, throttle or debounce. Paste a delivery to see what the deployed filter would do.
          </p>
          <div className="space-y-3">
            {filtered.map((f) => (
              <FilterTest key={f.name} workspace={workspace} tenant={tenant} flow={f.name} trigger={f.trigger} filter={f.filter} />
            ))}
          </div>
        </section>
      )}

      {/* Before any flow rule gets a say: did the request reach us, and was
          it who it claimed to be. A bad token or a failed signature never
          becomes a trigger event, so this is the only place it shows. */}
      {deliveries.length > 0 && (
        <DataTable
          title={<>Deliveries at the hook and inbox URLs{refused.length > 0 && <span className="ml-2 font-normal normal-case tracking-normal text-red-600">{refused.length} refused before any flow rule applied</span>}</>}
          columns={[{ label: "When" }, { label: "Flow" }, { label: "Outcome" }, { label: "Detail" }]}
          rows={deliveries.map((d, i) => ({
            key: `${d.t}-${i}`,
            tone: d.outcome !== "accepted" && d.outcome !== "dropped" ? "error" : undefined,
            cells: [
              <span className="whitespace-nowrap text-fg-muted">{when(d.t)}</span>,
              <span className="font-medium">{d.flow}</span>,
              <span>
                <Badge variant={d.outcome === "accepted" ? "success" : d.outcome === "dropped" ? "default" : "error"}>{d.outcome}</Badge>
                {d.count && d.count > 1 && <span className="ml-1 text-fg-muted" title={d.first ? `first ${when(d.first)}` : undefined}>×{d.count}</span>}
              </span>,
              <span className="text-fg-tertiary">{d.detail || "—"}</span>,
            ],
          }))}
        />
      )}

      {/* The other direction: what this workspace SENT. Every notify:
          webhook delivery, each attempt, and Redeliver. */}
      <section id="deliveries" className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-fg">Outbound webhook deliveries</h2>
        <p className="mb-3 text-sm text-fg-muted">
          Every notification this workspace&apos;s <code className="text-xs">notify:</code> url was sent. A failed one is retried at 1m, 5m, 30m, 2h and 6h, then given up; each attempt is listed.
        </p>
        <WebhookDeliveries workspace={workspace} />
      </section>
    </main>
  );
}
