// Below the hook rows on Tools & hooks → Hooks: what the rows cannot say.
// Which event each hook listens for, who turns it on, a Test box — and what
// the hooks stopped or changed lately, read off the runs' own trails, where
// every line a hook wrote carries a `hook` record (core store.ts RunEvent.hook).

import Link from "next/link";
import { listRuns } from "@/lib/store";
import { listWorkspaceHooks, HOOK_SAMPLE } from "@/server/hooks";
import { hookActivity, hookTally, hookBadge, HOOK_TONE } from "@/components/hooks-model";
import { HookTest } from "@/components/hook-test";
import { Panel, Chip, EmptyState } from "@/components/kit/page";
import { Table, THead, TBody, TR, TH, TD } from "@/components/kit/table";
import { ShieldCheck } from "lucide-react";
import { Tooltip } from "@/components/kit/tooltip";

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
    <div className="mt-10 space-y-10">
      {hooks.length > 0 && (
        <Panel
          title="When each runs"
          description="The event each hook listens for, and who turns it on."
          actions={
            <Link href={`/api/workspaces/${workspace}/hooks`} className="text-[13px] font-medium text-fg-muted hover:text-fg">
              As JSON
            </Link>
          }
          flush
        >
          <Table className="min-w-[820px]">
            <THead>
              <tr>
                <TH>Hook</TH>
                <TH>On</TH>
                <TH>Where</TH>
                <TH>Turned on by</TH>
                <TH>Last {HOOK_RUNS_READ} runs</TH>
                <TH className="text-right">Test</TH>
              </tr>
            </THead>
            <TBody>
              {hooks.map((h) => {
                const t = tally.get(h.name);
                return (
                  <TR key={`${h.scope}:${h.name}`} className={h.error ? "bg-danger-soft" : undefined}>
                    <TD className="align-top">
                      <span className="font-medium text-fg">{h.name}</span>
                      {h.error && <p className="text-xs text-danger">{h.error}</p>}
                    </TD>
                    <TD className="align-top">
                      {h.on ? (
                        <span className="whitespace-nowrap font-mono text-xs text-fg-secondary">
                          {h.on}
                          {h.tool && <span className="text-fg-muted"> · {h.tool}</span>}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TD>
                    <TD className="align-top text-fg-muted">
                      {h.scope === "workspace" ? workspace : "shared"}
                      {h.shadowed && (
                        <Tooltip label="a workspace hook of the same name is the one that runs">
                          <span className="ml-1 text-xs text-fg-subtle">(shadowed)</span>
                        </Tooltip>
                      )}
                    </TD>
                    <TD className="align-top">
                      {h.onFor.length === 0 ? (
                        <span className="text-fg-subtle">nobody yet</span>
                      ) : (
                        h.onFor.map((who) => (who === "account" ? "every agent (account)" : who === "workspace" ? "every agent here" : who)).join(", ")
                      )}
                    </TD>
                    <TD className="align-top">
                      {!t ? (
                        <span className="text-fg-subtle">nothing</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {t.deny > 0 && <Chip tone="bad">{t.deny} denied</Chip>}
                          {t.rewrite > 0 && <Chip tone="warn">{t.rewrite} rewrote</Chip>}
                          {t.error > 0 && <Chip tone="bad">{t.error} failed</Chip>}
                        </span>
                      )}
                    </TD>
                    <TD className="align-top text-right">
                      {!h.error && !h.shadowed && h.on ? (
                        <HookTest workspace={workspace} tenant={tenant} hook={h.name} sample={JSON.stringify(HOOK_SAMPLE[h.on], null, 2)} />
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Panel>
      )}

      {(hooks.length > 0 || activity.length > 0) && (
      <Panel title="Lately" description={`What hooks denied, rewrote or failed in the last ${HOOK_RUNS_READ} runs.`} flush>
        {activity.length === 0 ? (
          <EmptyState
            bare
            compact
            icon={<ShieldCheck />}
            title={hooks.length === 0 ? "Nothing to show until a hook is turned on." : "Nothing denied, rewritten or failed."}
          />
        ) : (
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Hook</TH>
                <TH>Tool</TH>
                <TH>Why</TH>
                <TH>Run</TH>
              </tr>
            </THead>
            <TBody>
              {activity.slice(0, 100).map((a, i) => {
                const b = hookBadge(a.record);
                return (
                  <TR key={`${a.runId}-${a.step}-${i}`}>
                    <TD className="whitespace-nowrap text-fg-muted">{when(a.t)}</TD>
                    <TD>
                      <Chip tone={HOOK_TONE[b.tone]}>{b.label}</Chip>
                    </TD>
                    <TD className="font-mono text-xs">{a.record.tool ?? a.record.event}</TD>
                    <TD className="text-fg-tertiary">{a.record.reason || "—"}</TD>
                    <TD>
                      <Link href={`/dashboard/${workspace}/runs/${a.runId}${qs}`} className="whitespace-nowrap text-fg-muted hover:text-fg hover:underline">
                        {a.flow} · step {a.step} ({a.agent})
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>
      )}
    </div>
  );
}
