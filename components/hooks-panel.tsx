// Below the hook cards on Assets → Hooks: what the cards cannot say. Which
// event each hook listens for, who turns it on, a Test box — and what the
// hooks stopped or changed lately, read off the runs' own trails, where every
// line a hook wrote carries a `hook` record (core store.ts RunEvent.hook).

import Link from "next/link";
import { listRuns } from "@/lib/store";
import { listWorkspaceHooks, HOOK_SAMPLE } from "@/server/hooks";
import { hookActivity, hookTally, hookBadge, HOOK_TONE } from "@/components/hooks-model";
import { Badge } from "@/components/ui";
import { DataTable } from "@/components/data";
import { HookTest } from "@/components/hook-test";

/** How far back "lately" reaches: the newest runs, not a date window, so a
 *  quiet workspace still shows its last deny. */
export const HOOK_RUNS_READ = 50;

const when = (iso: string) => iso.replace("T", " ").slice(0, 16);

export function HooksPanel({ tenant, workspace }: { tenant: string; workspace: string }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const hooks = listWorkspaceHooks(tenant, workspace);
  const activity = hookActivity(listRuns(tenant, workspace).slice(0, HOOK_RUNS_READ), { loud: true });
  const tally = hookTally(activity);

  return (
    <section className="mt-8 space-y-6">
      {hooks.length > 0 && (
        <DataTable
          title="When each runs, and who turns it on"
          action={<Link href={`/api/workspaces/${workspace}/hooks`} className="text-xs font-medium text-fg-muted hover:text-fg">As JSON →</Link>}
          columns={[{ label: "Hook" }, { label: "On" }, { label: "Where" }, { label: "Turned on by" }, { label: `Last ${HOOK_RUNS_READ} runs` }, { label: "" }]}
          rows={hooks.map((h) => {
            const t = tally.get(h.name);
            return {
              key: `${h.scope}:${h.name}`,
              tone: h.error ? ("error" as const) : undefined,
              cells: [
                <div key="n" className="min-w-0">
                  <span className="font-medium">{h.name}</span>
                  {h.error && <p className="text-xs text-red-700">{h.error}</p>}
                </div>,
                h.on ? (
                  <span key="o" className="whitespace-nowrap font-mono text-xs text-fg-secondary">
                    {h.on}
                    {h.tool && <span className="text-fg-muted"> · {h.tool}</span>}
                  </span>
                ) : <span key="o" className="text-fg-subtle">—</span>,
                <span key="w" className="text-fg-muted">
                  {h.scope === "workspace" ? workspace : "shared"}
                  {h.shadowed && <span className="ml-1 text-xs text-fg-subtle" title="a workspace hook of the same name is the one that runs">(shadowed)</span>}
                </span>,
                h.onFor.length === 0 ? (
                  <span key="u" className="text-fg-subtle">nobody yet</span>
                ) : (
                  <span key="u" className="text-fg-secondary">
                    {h.onFor.map((who) => (who === "account" ? "every agent (account)" : who === "workspace" ? "every agent here" : who)).join(", ")}
                  </span>
                ),
                !t ? (
                  <span key="t" className="text-fg-subtle">nothing</span>
                ) : (
                  <span key="t" className="flex flex-wrap gap-1">
                    {t.deny > 0 && <Badge variant="error">{t.deny} denied</Badge>}
                    {t.rewrite > 0 && <Badge variant="warning">{t.rewrite} rewrote</Badge>}
                    {t.error > 0 && <Badge variant="error">{t.error} failed</Badge>}
                  </span>
                ),
                !h.error && !h.shadowed && h.on ? (
                  <HookTest key="x" workspace={workspace} tenant={tenant} hook={h.name} sample={JSON.stringify(HOOK_SAMPLE[h.on], null, 2)} />
                ) : <span key="x" />,
              ],
            };
          })}
          minWidth="min-w-[820px]"
        />
      )}

      <DataTable
        title="Denied, rewritten or failed lately"
        columns={[{ label: "When" }, { label: "Hook" }, { label: "Tool" }, { label: "Why" }, { label: "Run" }]}
        empty={
          hooks.length === 0
            ? "Nothing to show until a hook is turned on."
            : `No hook denied, rewrote or failed anything in the last ${HOOK_RUNS_READ} runs.`
        }
        rows={activity.slice(0, 100).map((a, i) => {
          const b = hookBadge(a.record);
          return {
            key: `${a.runId}-${a.step}-${i}`,
            cells: [
              <span key="t" className="whitespace-nowrap text-fg-muted">{when(a.t)}</span>,
              <span key="h" className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${HOOK_TONE[b.tone]}`}>{b.label}</span>,
              <span key="o" className="font-mono text-xs text-fg-secondary">{a.record.tool ?? a.record.event}</span>,
              <span key="r" className="text-fg-tertiary">{a.record.reason || "—"}</span>,
              <Link key="l" href={`/dashboard/${workspace}/runs/${a.runId}${qs}`} className="whitespace-nowrap text-fg-muted hover:text-fg hover:underline">
                {a.flow} · step {a.step} ({a.agent})
              </Link>,
            ],
          };
        })}
        minWidth="min-w-[760px]"
      />
    </section>
  );
}
