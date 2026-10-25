// The workspace page's own lists, under the same status line, Needs
// attention and Now & next as the account home (mission-control.tsx):
// its flows, each with its last runs as a strip, when it next fires and a
// Run button, and its agents, each with how it last went. The flow strip is
// the run history, so the Recent runs list that repeated it is gone; the file
// tree moved to Edit, where files are opened anyway.

import Link from "next/link";
import { RunButton } from "@/app/dashboard/run-button";
import { Badge } from "./ui";
import { OUTCOME } from "./outcome-model";
import { fmtSpan, type Heartbeat } from "./mission-model";
import { fmtAgo } from "./overview-model";
import { creditsShort } from "./money";
import { fmtIn, type AgentRow, type FlowRow } from "./workspace-overview-model";
import { humanSchedule } from "./schedule-human";
import { Cells, CellLegend, Panel } from "./mission-control";
import { runHref } from "./run-href";

const STRIP = 12;

// An agent's last status is a step status, not a run outcome.
const STEP_DOT: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  running: "bg-sky-500 animate-pulse",
  "awaiting-approval": "bg-violet-500",
  skipped: "bg-gray-300",
  stopped: "bg-gray-400",
};

export function FlowsPanel({ workspace, tenant, flows, strips, now }: { workspace: string; tenant: string; flows: FlowRow[]; strips: Map<string, Heartbeat>; now: number }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  return (
    <Panel
      title="Flows"
      count={flows.length}
      className="mb-4"
      action={
        <span className="flex items-center gap-4">
          <CellLegend />
          <Link href={`/dashboard/${workspace}/flows${qs}`} className="text-[11px] font-medium text-fg-muted hover:text-fg">All flows →</Link>
        </span>
      }
    >
      {flows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-fg-subtle">No flows yet — a flow is a numbered list of agents in flows/.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2 font-medium">Flow</th>
                <th className="px-2 py-2 font-medium">Last {STRIP} runs</th>
                <th className="px-2 py-2 font-medium">Latest</th>
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 text-right font-medium">7d</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {flows.map((f) => {
                const beat = strips.get(f.name);
                const last = beat?.last ?? null;
                return (
                  <tr key={f.name} className="hover:bg-sunken/60">
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`} className="font-medium text-fg hover:underline">{f.name}</Link>
                        {f.live > 0 && (
                          <Link href={f.liveRunId ? runHref(workspace, f.liveRunId, tenant) : `/dashboard/${workspace}/runs${qs}`} title="Watch it run" className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 hover:underline">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />{f.live} live
                          </Link>
                        )}
                      </div>
                      <div className="text-[11px] text-fg-subtle">{f.steps} step{f.steps === 1 ? "" : "s"}</div>
                    </td>
                    <td className="px-2 py-2">{beat ? <Cells beat={beat} n={STRIP} tenant={tenant} /> : null}</td>
                    <td className="max-w-[20rem] px-2 py-2">
                      {last ? (
                        <Link href={runHref(workspace, last.id, tenant)} className="group flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME[last.outcome].dot}`} />
                          <span className="truncate text-xs text-fg-tertiary group-hover:text-fg group-hover:underline" title={last.headline ?? last.outcome}>
                            {last.failure ? `${last.failure.agent}: ${last.failure.reason}` : last.headline ?? OUTCOME[last.outcome].hint}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-subtle">{fmtSpan(now - Date.parse(last.startedAt))}</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-fg-subtle">never ran</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-[11px] text-fg-muted">
                      {f.schedule ? (
                        <span title={f.schedule}>
                          {humanSchedule(f.schedule) ?? f.schedule}
                          {f.nextFireAt && <span className="text-fg"> · {fmtIn(Date.parse(f.nextFireAt) - now)}</span>}
                        </span>
                      ) : (
                        <Badge>{f.trigger}</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-[11px] tabular-nums text-fg-muted">
                      {f.runs7d} · {creditsShort(f.spend7d)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <RunButton endpoint={`/api/workspaces/${workspace}/flows/${f.name}/run`} tenant={tenant} label="Run" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function AgentsPanel({ workspace, tenant, agents, now }: { workspace: string; tenant: string; agents: AgentRow[]; now: number }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  return (
    <Panel
      title="Agents"
      count={agents.length}
      className="mb-4"
      action={<Link href={`/dashboard/${workspace}/agents${qs}`} className="text-[11px] font-medium text-fg-muted hover:text-fg">All agents →</Link>}
    >
      {agents.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-fg-subtle">No agents yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-2 py-2 font-medium">Does</th>
                <th className="px-2 py-2 font-medium">Model</th>
                <th className="px-2 py-2 font-medium">Last step</th>
                <th className="px-4 py-2 text-right font-medium">7d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {agents.map((a) => (
                <tr key={a.name} className="hover:bg-sunken/60">
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`agents/${a.name}/agent.md`)}${rest}`} className="font-medium text-fg hover:underline">{a.name}</Link>
                  </td>
                  <td className="max-w-[26rem] px-2 py-2"><span className="line-clamp-1 text-xs text-fg-muted" title={a.description}>{a.description || "—"}</span></td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-fg-muted">{a.model}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    {a.last ? (
                      <span className="flex items-center gap-1.5 text-fg-tertiary">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${STEP_DOT[a.last] ?? "bg-gray-400"}`} />
                        {a.last}
                        {a.lastAt && <span className="text-fg-subtle">· {fmtAgo(now - Date.parse(a.lastAt))}</span>}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">never ran</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-[11px] tabular-nums text-fg-muted">
                    {a.runs7d} · {creditsShort(a.spend7d)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
