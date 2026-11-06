// Triggers — what starts each flow on its own, and why nothing happened.
//
// Every other page in the dashboard is about runs that exist. This one is
// also about the ones that do not, which is the harder question and the one
// support actually gets: "the hook fired and nothing ran."
//
// Every answer to it is a thing that deliberately did not happen — a
// duplicate delivery, a burst still being waited out, a flow switched off
// after a bad week, a schedule the platform slept through. All correct
// behaviour; none of it visible elsewhere. The fix, when there is one, is
// always a key in the flow file, so every reason names the key that decided.
//
// Tabs (`?tab=`): the triggers themselves, with what each fired and ran in
// the window (`?since=` days); every decision, newest first; the deliveries
// at the hook and inbox URLs (did the request reach us and was it authentic
// — a bad token never gets as far as a flow rule) with the filter tester;
// the notify: webhooks this workspace sent; and the flows outside agents
// call over A2A.

import Link from "next/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listFlows, type FlowInfo } from "@/lib/store";
import { summariseTriggers, readTriggerEvents, type TriggerOutcome } from "@/lib/trigger-log";
import { readDeliveries } from "@/lib/webhook";
import { parseCron, nextFire } from "@/platform/scheduler";
import { fmtIn } from "@/components/workspace-overview-model";
import { nowMs } from "@/components/overview-model";
import { LocalTime } from "@/components/local-time";
import { Page, PageHeader, Panel, PanelList, EmptyState, StatGrid, Stat, Tag, Chip, ResourceCard, type Tone } from "@/components/kit/page";
import { ResourceList, type Row } from "@/components/kit/list";
import { PageTabs } from "@/components/kit/page-tabs";
import { TableCard, Table, THead, TBody, TR, TH, TD } from "@/components/kit/table";
import { buttonVariants } from "@/components/kit/button";
import { CalendarClock, Clock3, Eye, FileJson, FolderInput, Hand, Link2, Mail, Webhook, Zap } from "lucide-react";
import { triggerLine } from "../flows/trigger-line";
import { WebhookDeliveries } from "./webhook-deliveries";
import { FilterTest } from "./filter-test";
import { A2aPanel } from "./a2a-panel";
import { HashTab } from "./hash-tab";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

/** What each outcome means in one phrase, and the key that caused it. The
 *  point of the page is that a person can go and change that key. */
const REASON: Record<TriggerOutcome, { label: string; key: string; tone: Tone }> = {
  started: { label: "started a run", key: "", tone: "good" },
  duplicate: { label: "duplicate delivery", key: "idempotency:", tone: "default" },
  throttled: { label: "inside the window", key: "throttle:", tone: "warn" },
  debounced: { label: "held for the burst", key: "debounce:", tone: "info" },
  quarantined: { label: "flow switched off", key: "disable_after:", tone: "bad" },
  paused: { label: "work is done, paused", key: "pause_when:", tone: "good" },
  halted: { label: "paused by a person", key: "Settings → Governance → Pause", tone: "bad" },
  "overlap-skipped": { label: "previous run still live", key: "overlap: skip", tone: "warn" },
  missed: { label: "missed while down", key: "catchup: none", tone: "warn" },
  filtered: { label: "did not match the filter", key: "filter:", tone: "default" },
  "queue-full": { label: "too many runs waiting", key: "Settings → Governance → Compute", tone: "warn" },
  failed: { label: "could not start", key: "", tone: "bad" },
};

function Outcome({ outcome }: { outcome: TriggerOutcome }) {
  const r = REASON[outcome] ?? REASON.failed;
  return <Chip tone={r.tone}>{r.label}</Chip>;
}

const ICON: Record<string, React.ReactNode> = {
  schedule: <Clock3 />,
  webhook: <Webhook />,
  email: <Mail />,
  storage: <FolderInput />,
  watch: <Eye />,
  flow: <Link2 />,
  once: <CalendarClock />,
  manual: <Hand />,
};
const iconOf = (trigger: string) => ICON[trigger] ?? <Zap />;

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export default async function TriggersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; since?: string; tab?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", since, tab = "triggers" } = await searchParams;
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  const days = Math.min(Math.max(Number(since) || 7, 1), 365);
  const now = nowMs();
  const sinceMs = now - days * 86400_000;
  const summary = summariseTriggers(tenant, workspace, sinceMs);
  const events = readTriggerEvents(tenant, workspace, 200).filter((e) => new Date(e.t).getTime() >= sinceMs);
  const deliveries = readDeliveries(tenant, workspace, 50);
  const refused = deliveries.filter((d) => d.outcome !== "accepted" && d.outcome !== "dropped");
  let flows: FlowInfo[] = [];
  try {
    flows = listFlows(tenant, workspace);
  } catch {
    /* a workspace whose flows cannot be listed shows the log alone */
  }
  // Flows that say which deliveries are theirs (`filter:`), for the Test box.
  const filtered = flows.filter((f) => f.filter != null).map((f) => ({ name: f.name, trigger: f.trigger, filter: f.filter }));

  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}/triggers`;
  const sinceParam = days !== 7 ? `&since=${days}` : "";
  const tabHref = (t: string) => `${base}?tab=${t}${sinceParam}${tenantParam}`;
  const flowHref = (name: string, t?: string) => `/dashboard/${workspace}/flows?flow=${encodeURIComponent(name)}${t ? `&tab=${t}` : ""}${tenantParam}`;
  const fired = summary.reduce((n, f) => n + f.fired, 0);
  const started = summary.reduce((n, f) => n + f.started, 0);

  // Every flow that starts on its own, and any flow the log names that is
  // not in the folder any more (renamed, deleted) — its record still counts.
  const byFlow = new Map(summary.map((s) => [s.flow, s]));
  const known = new Set(flows.map((f) => f.name));
  const listed = [
    ...flows.filter((f) => (f.trigger && f.trigger !== "manual") || byFlow.has(f.name)).map((f) => ({ name: f.name, trigger: f.trigger || "manual", line: triggerLine(f), info: f as FlowInfo | null })),
    ...summary.filter((s) => !known.has(s.flow)).map((s) => ({ name: s.flow, trigger: s.trigger, line: "Not in the workspace any more", info: null })),
  ];
  const nextOf = (f: FlowInfo | null) => {
    if (!f || f.trigger !== "schedule" || !f.schedule) return null;
    const cron = parseCron(f.schedule);
    const at = cron ? nextFire(cron, new Date(now), f.timezone ?? "UTC") : null;
    return at ? fmtIn(at.getTime() - now) : null;
  };

  const rows: Row[] = listed.map((t) => {
    const s = byFlow.get(t.name);
    const heldBack = s ? s.fired - s.started : 0;
    const top = s?.dropped[0];
    const next = nextOf(t.info);
    const href = t.info ? flowHref(t.name) : `/dashboard/${workspace}/runs?flow=${encodeURIComponent(t.name)}${tenantParam}`;
    const reasons = s?.dropped.map((d) => `${REASON[d.outcome]?.label ?? d.outcome} ×${d.count}${REASON[d.outcome]?.key ? ` (${REASON[d.outcome].key})` : ""}`).join("\n");
    return {
      key: t.name,
      search: [t.name, t.trigger, t.line, ...(s?.dropped.map((d) => REASON[d.outcome]?.label ?? d.outcome) ?? [])].join(" "),
      href,
      icon: iconOf(t.trigger),
      name: t.name,
      sub: t.line,
      cells: {
        kind: <Tag>{t.trigger}</Tag>,
        ran: s ? (
          <span className="tabular-nums">
            {s.started} of {s.fired}
          </span>
        ) : (
          <span className="text-fg-subtle">nothing fired</span>
        ),
        held: heldBack > 0 && top ? (
          <span title={reasons} className="inline-flex items-center gap-1.5">
            <Outcome outcome={top.outcome} />
            <span className="text-fg-muted">
              ×{top.count}
              {s!.dropped.length > 1 ? ` +${s!.dropped.length - 1}` : ""}
            </span>
          </span>
        ) : undefined,
        last: s?.lastFiredAt ? <LocalTime iso={s.lastFiredAt} options={WHEN} /> : next ? <span className="text-fg-muted">next {next}</span> : undefined,
      },
      action: t.info ? (
        <Link href={flowHref(t.name, "settings")} className={buttonVariants({ variant: "secondary" })}>
          Change
        </Link>
      ) : undefined,
      card: (
        <ResourceCard
          href={href}
          icon={iconOf(t.trigger)}
          name={t.name}
          sub={t.line}
          status={!s ? "idle" : heldBack > 0 && s.started === 0 ? "error" : "live"}
          statusLabel={s ? `${s.started} of ${s.fired} became runs` : "nothing fired"}
          lines={[
            <><Zap /><span className="truncate">{s ? `${s.fired} fired · ${s.started} ran` : "Nothing fired in this window"}</span></>,
            ...(top ? [<><Hand /><span className="truncate">Held back: {REASON[top.outcome]?.label ?? top.outcome} ×{top.count}</span></>] : []),
            ...(next ? [<><Clock3 /><span className="truncate">Next {next}</span></>] : []),
          ]}
        />
      ),
    };
  });

  const dropped = summary.flatMap((s) => s.dropped.map((d) => ({ flow: s.flow, ...d })));

  return (
    <Page>
      <HashTab tab={tab} />
      <PageHeader
        title="Triggers"
        description="What starts each flow on its own, every time something tried, and what became of it."
        actions={
          <>
            <div role="group" aria-label="Window" className="inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5">
              {WINDOWS.map((w) => (
                <Link
                  key={w.days}
                  href={`${base}?tab=${tab}${w.days !== 7 ? `&since=${w.days}` : ""}${tenantParam}`}
                  aria-current={w.days === days ? "true" : undefined}
                  className={`flex h-full items-center rounded-sm px-2.5 text-[13px] font-medium transition-colors ${w.days === days ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-fg-muted hover:text-fg"}`}
                >
                  {w.label}
                </Link>
              ))}
            </div>
            <Link href={`/api/workspaces/${workspace}/triggers?since=${days}`} className={buttonVariants({ variant: "secondary" })}>
              <FileJson aria-hidden />
              As JSON
            </Link>
          </>
        }
      />

      <StatGrid className="mb-8 grid-cols-3 md:grid-cols-3 xl:grid-cols-3">
        <Stat label="Triggers fired" value={fired} sub={`in ${WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`}`} />
        <Stat label="Became runs" value={started} />
        <Stat label="Held back" value={fired - started} tone={fired - started > 0 ? "warning" : undefined} sub={refused.length ? `${refused.length} refused at the door` : undefined} />
      </StatGrid>

      <PageTabs
        tabs={[
          { label: "Triggers", href: tabHref("triggers"), active: tab === "triggers", badge: listed.length || undefined },
          { label: "Activity", href: tabHref("activity"), active: tab === "activity", badge: events.length || undefined },
          { label: "Deliveries", href: tabHref("deliveries"), active: tab === "deliveries", badge: refused.length || undefined },
          { label: "Outbound", href: tabHref("outbound"), active: tab === "outbound" },
          { label: "A2A", href: tabHref("a2a"), active: tab === "a2a" },
        ]}
      />

      {tab === "triggers" && (
        <div className="space-y-8">
          <ResourceList
            id="triggers"
            search="Search triggers…"
            nameHeader="Flow"
            columns={[
              { key: "kind", header: "Trigger", hide: "md" },
              { key: "ran", header: "Ran of fired", hide: "sm" },
              { key: "held", header: "Held back", hide: "lg" },
              { key: "last", header: "Last fired", hide: "md" },
            ]}
            rows={rows}
            empty={
              <EmptyState
                icon={<Zap />}
                title="No flow here starts on its own"
                description="Scheduled, webhook, email, storage, watch and chained flows are listed here with what they fired and what became a run. A workspace of manual flows stays empty, which is correct."
                action={
                  <Link href={`/dashboard/${workspace}/flows${qs}`} className={buttonVariants({ variant: "secondary" })}>
                    Flows
                  </Link>
                }
              />
            }
          />
          {dropped.length > 0 && (
            <Panel title="Held back, and why" description="Each reason is a key in the flow file — change it there to change what happens." flush>
              <PanelList>
                {dropped.map((d) => (
                  <li key={`${d.flow}:${d.outcome}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{d.flow}</span>
                    <Outcome outcome={d.outcome} />
                    <span className="text-sm tabular-nums text-fg-muted">×{d.count}</span>
                    {REASON[d.outcome]?.key && <Tag mono>{REASON[d.outcome].key}</Tag>}
                    {d.detail && <span className="w-full min-w-0 truncate text-sm text-fg-muted sm:ml-auto sm:w-auto sm:max-w-md" title={d.detail}>{d.detail}</span>}
                  </li>
                ))}
              </PanelList>
            </Panel>
          )}
        </div>
      )}

      {tab === "activity" &&
        (events.length === 0 ? (
          <EmptyState
            icon={<Zap />}
            title="Nothing has tried to start a flow in this window"
            description="Scheduled, webhook, email, storage, watch and chained flows all record here — whether they started a run or were held back by one of the flow's own rules."
          />
        ) : (
          <TableCard>
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Flow</TH>
                  <TH>Outcome</TH>
                  <TH>Detail</TH>
                </tr>
              </THead>
              <TBody>
                {events.slice(0, 100).map((e, i) => (
                  <TR key={`${e.t}-${i}`}>
                    <TD className="whitespace-nowrap tabular-nums text-fg-muted">
                      <LocalTime iso={e.t} options={WHEN} />
                    </TD>
                    <TD className="font-medium text-fg">{known.has(e.flow) ? <Link href={flowHref(e.flow)} className="hover:underline">{e.flow}</Link> : e.flow}</TD>
                    <TD>
                      <Outcome outcome={e.outcome} />
                    </TD>
                    <TD className="text-fg-muted">{e.detail || "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableCard>
        ))}

      {tab === "deliveries" && (
        <div className="space-y-8">
          {/* Before any flow rule gets a say: did the request reach us, and
              was it who it claimed to be. A bad token or a failed signature
              never becomes a trigger event, so this is the only place it
              shows. */}
          <Panel
            title="At the hook and inbox URLs"
            description={refused.length ? `${refused.length} refused before any flow rule applied.` : "Each request to a flow's webhook or inbox, and whether it was let in."}
            flush
          >
            {deliveries.length === 0 ? (
              <EmptyState bare compact icon={<Webhook />} title="No deliveries yet" description="A webhook or email flow records each request it receives here." />
            ) : (
              <Table className="min-w-[640px]">
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>Flow</TH>
                    <TH>Outcome</TH>
                    <TH>Detail</TH>
                  </tr>
                </THead>
                <TBody>
                  {deliveries.map((d, i) => (
                    <TR key={`${d.t}-${i}`}>
                      <TD className="whitespace-nowrap tabular-nums text-fg-muted">
                        <LocalTime iso={d.t} options={WHEN} />
                      </TD>
                      <TD className="font-medium text-fg">{d.flow}</TD>
                      <TD className="whitespace-nowrap">
                        <Chip tone={d.outcome === "accepted" ? "good" : d.outcome === "dropped" ? "default" : "bad"}>{d.outcome}</Chip>
                        {d.count && d.count > 1 ? (
                          <span className="ml-1.5 text-fg-muted" title={d.first ? `first ${d.first}` : undefined}>
                            ×{d.count}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-fg-muted">{d.detail || "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>

          {/* The flows that only start for some deliveries, and a box to try
              one. A filtered delivery is "did not match the filter". */}
          <Panel
            id="filters"
            title="Filters"
            description={
              <>
                A flow with <code className="font-mono text-[13px]">filter:</code> starts only for deliveries whose fields match it. Paste a delivery to see what the deployed filter would do — nothing is started.
              </>
            }
            flush
          >
            {filtered.length === 0 ? (
              <EmptyState bare compact title="No flow here has a filter" description="Every delivery to a flow without filter: is its own." />
            ) : (
              <div className="divide-y divide-line">
                {filtered.map((f) => (
                  <FilterTest key={f.name} workspace={workspace} tenant={tenant} flow={f.name} trigger={f.trigger} filter={f.filter} />
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* The other direction: what this workspace SENT. Every notify:
          webhook delivery, each attempt, and Redeliver. */}
      {tab === "outbound" && (
        <Panel
          id="deliveries"
          title="Outbound webhook deliveries"
          description={
            <>
              Every notification this workspace&apos;s <code className="font-mono text-[13px]">notify:</code> url was sent. A failed one is retried at 1m, 5m, 30m, 2h and 6h, then given up.
            </>
          }
          bodyClassName="p-0 border-0 bg-transparent overflow-visible"
        >
          <WebhookDeliveries workspace={workspace} />
        </Panel>
      )}

      {/* Outside agents (A2A, 1 Nov 2026): the flows this workspace serves
          over A2A, the keys that may call them, the newest tasks. */}
      {tab === "a2a" && <A2aPanel workspace={workspace} tenant={tenant} />}
    </Page>
  );
}
