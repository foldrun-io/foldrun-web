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

import { WEBHOOK_OUTCOME_LABEL, labelOf } from "@/components/value-labels";
import { $rich, $t, localized, localizedList } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import { notFound } from "next/navigation";
import { workspaceDir, listFlows, type FlowInfo } from "@/lib/store";
import { summariseTriggers, readTriggerEvents, type TriggerOutcome } from "@/lib/trigger-log";
import { readDeliveries } from "@/lib/webhook";
import { parseCron, nextFire } from "@/platform/scheduler";
import { fmtIn } from "@/components/workspace-overview-model";
import { nowMs } from "@/components/overview-model";
import { LocalTime } from "@/components/local-time";
import { Page, PageHeader, Panel, PanelList, EmptyState, StatGrid, Stat, Tag, Chip, ResourceCard, type Tone } from "@foldrun/ui/react/page";
import { ResourceList, type Row } from "@foldrun/ui/react/list";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { TableCard, Table, THead, TBody, TR, TH, TD } from "@foldrun/ui/react/table";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { CalendarClock, Clock3, Eye, FileJson, FolderInput, Hand, Link2, Mail, Webhook, Zap } from "lucide-react";
import { triggerLine } from "../flows/trigger-line";
import { WebhookDeliveries } from "./webhook-deliveries";
import { FilterTest } from "./filter-test";
import { A2aPanel } from "./a2a-panel";
import { HashTab } from "./hash-tab";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

const WINDOWS = localizedList(() => [
  { days: 1, label: "24h" },
  { days: 7, label: $t("workspace.triggers-page.7Days") },
  { days: 30, label: $t("workspace.triggers-page.30Days") },
]);

/** What each outcome means in one phrase, and the key that caused it. The
 *  point of the page is that a person can go and change that key. */
const REASON: Record<TriggerOutcome, { label: string; key: string; tone: Tone }> = localized(() => ({
  started: { label: $t("workspace.triggers-page.startedARun"), key: "", tone: "good" },
  duplicate: { label: $t("workspace.triggers-page.duplicateDelivery"), key: "idempotency:", tone: "default" },
  throttled: { label: $t("workspace.triggers-page.insideTheWindow"), key: "throttle:", tone: "warn" },
  debounced: { label: $t("workspace.triggers-page.heldForTheBurst"), key: "debounce:", tone: "info" },
  quarantined: { label: $t("workspace.triggers-page.flowSwitchedOff"), key: "disable_after:", tone: "bad" },
  paused: { label: $t("workspace.triggers-page.workIsDonePaused"), key: "pause_when:", tone: "good" },
  halted: { label: $t("workspace.triggers-page.pausedByAPerson"), key: $t("workspace.triggers-page.settingsPoliciesPauseRuns"), tone: "bad" },
  "overlap-skipped": { label: $t("workspace.triggers-page.previousRunStillLive"), key: "overlap: skip", tone: "warn" },
  missed: { label: $t("workspace.triggers-page.missedWhileDown"), key: "catchup: none", tone: "warn" },
  filtered: { label: $t("workspace.triggers-page.didNotMatchTheFilter"), key: "filter:", tone: "default" },
  "queue-full": { label: $t("workspace.triggers-page.tooManyRunsWaiting"), key: $t("workspace.triggers-page.settingsPoliciesGovernance"), tone: "warn" },
  failed: { label: "could not start", key: "", tone: "bad" },
}));

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
  await requestLocale();
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
    ...summary.filter((s) => !known.has(s.flow)).map((s) => ({ name: s.flow, trigger: s.trigger, line: $t("workspace.triggers-page.notInTheWorkspaceAnyMore"), info: null })),
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
            {$t("workspace.triggers-page.of", { started: String(s.started), fired: String(s.fired) })}
          </span>
        ) : (
          <span className="text-fg-subtle">{$t("workspace.triggers-page.nothingFired")}</span>
        ),
        held: heldBack > 0 && top ? (
          <Tooltip label={reasons ? <span className="whitespace-pre-line">{reasons}</span> : undefined}>
            <span className="inline-flex items-center gap-1.5">
              <Outcome outcome={top.outcome} />
              <span className="text-fg-muted">
                ×{top.count}
                {s!.dropped.length > 1 ? ` +${s!.dropped.length - 1}` : ""}
              </span>
            </span>
          </Tooltip>
        ) : undefined,
        last: s?.lastFiredAt ? <LocalTime iso={s.lastFiredAt} options={WHEN} /> : next ? <span className="text-fg-muted">{$t("workspace.triggers-page.next", { next: next })}</span> : undefined,
      },
      action: t.info ? (
        <Link href={flowHref(t.name, "settings")} className={buttonVariants({ variant: "secondary" })}>
          {$t("workspace.triggers-page.change")}
        </Link>
      ) : undefined,
      card: (
        <ResourceCard
          href={href}
          icon={iconOf(t.trigger)}
          name={t.name}
          sub={t.line}
          status={!s ? "idle" : heldBack > 0 && s.started === 0 ? "error" : "live"}
          statusLabel={s ? $t("workspace.triggers-page.ofBecameRuns", { started: String(s.started), fired: String(s.fired) }) : $t("workspace.triggers-page.nothingFired")}
          lines={[
            <><Zap /><span className="truncate">{s ? $t("workspace.triggers-page.firedRan", { fired: String(s.fired), started: String(s.started) }) : $t("workspace.triggers-page.nothingFiredInThisWindow")}</span></>,
            ...(top ? [<><Hand /><span className="truncate">{$t("workspace.triggers-page.heldBack", { label: REASON[top.outcome]?.label ?? top.outcome, count: String(top.count) })}</span></>] : []),
            ...(next ? [<><Clock3 /><span className="truncate">{$t("workspace.triggers-page.next2", { next: next })}</span></>] : []),
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
        title={$t("workspace.triggers-page.triggers")}
        description={$t("workspace.triggers-page.whatStartsEachFlowOnIts")}
        actions={
          <>
            <div role="group" aria-label={$t("workspace.triggers-page.window")} className="inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5">
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
            <Link href={`/v1/workspaces/${workspace}/triggers?since=${days}`} className={buttonVariants({ variant: "secondary" })}>
              <FileJson aria-hidden />
              {$t("workspace.triggers-page.asJson")}
            </Link>
          </>
        }
      />

      <StatGrid className="mb-8 grid-cols-3 md:grid-cols-3 xl:grid-cols-3">
        <Stat label={$t("workspace.triggers-page.triggersFired")} value={fired} sub={$t("workspace.triggers-page.inWindow", { window: WINDOWS.find((w) => w.days === days)?.label ?? $t("workspace.triggers-page.nDays", { n: days }) })} />
        <Stat label={$t("workspace.triggers-page.becameRuns")} value={started} />
        <Stat label={$t("workspace.triggers-page.heldBack2")} value={fired - started} tone={fired - started > 0 ? "warning" : undefined} sub={refused.length ? $t("workspace.triggers-page.refusedAtTheDoor", { length: String(refused.length) }) : undefined} />
      </StatGrid>

      <PageTabs
        tabs={[
          { label: $t("workspace.triggers-page.triggers"), href: tabHref("triggers"), active: tab === "triggers", badge: listed.length || undefined },
          { label: $t("workspace.triggers-page.activity"), href: tabHref("activity"), active: tab === "activity", badge: events.length || undefined },
          { label: $t("workspace.triggers-page.deliveries"), href: tabHref("deliveries"), active: tab === "deliveries", badge: refused.length || undefined },
          { label: $t("workspace.triggers-page.outbound"), href: tabHref("outbound"), active: tab === "outbound" },
          { label: "A2A", href: tabHref("a2a"), active: tab === "a2a" },
        ]}
      />

      {tab === "triggers" && (
        <div className="space-y-8">
          <ResourceList
            id="triggers"
            search={$t("workspace.triggers-page.searchTriggers")}
            nameHeader="Flow"
            columns={[
              { key: "kind", header: $t("workspace.triggers-page.trigger"), hide: "md" },
              { key: "ran", header: $t("workspace.triggers-page.ranOfFired"), hide: "sm" },
              { key: "held", header: $t("workspace.triggers-page.heldBack2"), hide: "lg" },
              { key: "last", header: $t("workspace.triggers-page.lastFired"), hide: "md" },
            ]}
            rows={rows}
            empty={
              <EmptyState
                icon={<Zap />}
                title={$t("workspace.triggers-page.noFlowHereStartsOnIts")}
                description={$t("workspace.triggers-page.scheduledWebhookEmailStorageWatchAnd")}
                action={
                  <Link href={`/dashboard/${workspace}/flows${qs}`} className={buttonVariants({ variant: "secondary" })}>
                    {$t("workspace.triggers-page.flows")}
                  </Link>
                }
              />
            }
          />
          {dropped.length > 0 && (
            <Panel title={$t("workspace.triggers-page.heldBackAndWhy")} description={$t("workspace.triggers-page.eachReasonIsAKeyIn")} flush>
              <PanelList>
                {dropped.map((d) => (
                  <li key={`${d.flow}:${d.outcome}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{d.flow}</span>
                    <Outcome outcome={d.outcome} />
                    <span className="text-sm tabular-nums text-fg-muted">×{d.count}</span>
                    {REASON[d.outcome]?.key && <Tag mono>{REASON[d.outcome].key}</Tag>}
                    {d.detail && (
                      <Tooltip label={d.detail}>
                        <span className="w-full min-w-0 truncate text-sm text-fg-muted sm:ms-auto sm:w-auto sm:max-w-md">{d.detail}</span>
                      </Tooltip>
                    )}
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
            title={$t("workspace.triggers-page.nothingHasTriedToStartA")}
            description={$t("workspace.triggers-page.scheduledWebhookEmailStorageWatchAnd2")}
          />
        ) : (
          <TableCard>
            <Table className="min-w-[640px]">
              <THead>
                <tr>
                  <TH>{$t("workspace.triggers-page.when")}</TH>
                  <TH>{$t("workspace.triggers-page.flow")}</TH>
                  <TH>{$t("workspace.triggers-page.outcome")}</TH>
                  <TH>{$t("workspace.triggers-page.detail")}</TH>
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
            title={$t("workspace.triggers-page.atTheHookAndInboxUrls")}
            description={refused.length ? $t("workspace.triggers-page.refusedBeforeAnyFlowRuleApplied", { length: String(refused.length) }) : $t("workspace.triggers-page.eachRequestToAFlowS")}
            flush
          >
            {deliveries.length === 0 ? (
              <EmptyState bare compact icon={<Webhook />} title={$t("workspace.triggers-page.noDeliveriesYet")} description={$t("workspace.triggers-page.aWebhookOrEmailFlowRecords")} />
            ) : (
              <Table className="min-w-[640px]">
                <THead>
                  <tr>
                    <TH>{$t("workspace.triggers-page.when")}</TH>
                    <TH>{$t("workspace.triggers-page.flow")}</TH>
                    <TH>{$t("workspace.triggers-page.outcome")}</TH>
                    <TH>{$t("workspace.triggers-page.detail")}</TH>
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
                        <Chip tone={d.outcome === "accepted" ? "good" : d.outcome === "dropped" ? "default" : "bad"}>{labelOf(WEBHOOK_OUTCOME_LABEL, d.outcome)}</Chip>
                        {d.count && d.count > 1 ? (
                          <Tooltip label={d.first ? `first ${d.first}` : undefined}>
                            <span className="ms-1.5 text-fg-muted">
                              ×{d.count}
                            </span>
                          </Tooltip>
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
            title={$t("workspace.triggers-page.filters")}
            description={
              <>
                {$rich("workspace.triggers-page.aFlowWithFilterStartsOnly", { code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code> })}
              </>
            }
            flush
          >
            {filtered.length === 0 ? (
              <EmptyState bare compact title={$t("workspace.triggers-page.noFlowHereHasAFilter")} description={$t("workspace.triggers-page.everyDeliveryToAFlowWithout")} />
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
          title={$t("workspace.triggers-page.outboundWebhookDeliveries")}
          description={
            <>
              {$rich("workspace.triggers-page.everyNotificationThisTermSNotify", { code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code> })}
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
