// Below the hook rows on Tools & hooks → Hooks: what the rows cannot say.
// Which event each hook listens for, who turns it on, a Test box — and what
// the hooks stopped or changed lately, read off the runs' own trails, where
// every line a hook wrote carries a `hook` record (core store.ts RunEvent.hook).

import { $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { listRuns } from "@/lib/store";
import { listWorkspaceHooks, HOOK_SAMPLE } from "@/server/hooks";
import { hookActivity, hookTally, hookBadge, HOOK_TONE } from "@/components/hooks-model";
import { HookTest } from "@/components/hook-test";
import { Panel, Chip, EmptyState } from "@foldrun/ui/react/page";
import { Table, THead, TBody, TR, TH, TD } from "@foldrun/ui/react/table";
import { ShieldCheck } from "lucide-react";
import { Tooltip } from "@foldrun/ui/react/tooltip";

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
          title={$t("components.hooks-panel.whenEachRuns")}
          description={$t("components.hooks-panel.theEventEachHookListensFor")}
          actions={
            <Link href={`/api/workspaces/${workspace}/hooks`} className="text-[13px] font-medium text-fg-muted hover:text-fg">
              {$t("components.hooks-panel.asJson")}
            </Link>
          }
          flush
        >
          <Table className="min-w-[820px]">
            <THead>
              <tr>
                <TH>{$t("components.hooks-panel.hook")}</TH>
                <TH>{$t("components.hooks-panel.on")}</TH>
                <TH>{$t("components.hooks-panel.where")}</TH>
                <TH>{$t("components.hooks-panel.turnedOnBy")}</TH>
                <TH>{$t("components.hooks-panel.lastRuns", { HOOK_RUNS_READ: String(HOOK_RUNS_READ) })}</TH>
                <TH className="text-right">{$t("components.hooks-panel.test")}</TH>
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
                        <Tooltip label={$t("components.hooks-panel.aWorkspaceHookOfTheSame")}>
                          <span className="ml-1 text-xs text-fg-subtle">{$t("components.hooks-panel.shadowed")}</span>
                        </Tooltip>
                      )}
                    </TD>
                    <TD className="align-top">
                      {h.onFor.length === 0 ? (
                        <span className="text-fg-subtle">{$t("components.hooks-panel.nobodyYet")}</span>
                      ) : (
                        h.onFor.map((who) => (who === "account" ? $t("components.hooks-panel.everyAgentAccount") : who === "workspace" ? $t("components.hooks-panel.everyAgentHere") : who)).join(", ")
                      )}
                    </TD>
                    <TD className="align-top">
                      {!t ? (
                        <span className="text-fg-subtle">{$t("components.hooks-panel.nothing")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {t.deny > 0 && <Chip tone="bad">{$t("components.hooks-panel.denied", { deny: String(t.deny) })}</Chip>}
                          {t.rewrite > 0 && <Chip tone="warn">{$t("components.hooks-panel.rewrote", { rewrite: String(t.rewrite) })}</Chip>}
                          {t.error > 0 && <Chip tone="bad">{$t("components.hooks-panel.failed", { error: String(t.error) })}</Chip>}
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
      <Panel title={$t("components.hooks-panel.lately")} description={$t("components.hooks-panel.whatHooksDeniedRewroteOrFailed", { HOOK_RUNS_READ: String(HOOK_RUNS_READ) })} flush>
        {activity.length === 0 ? (
          <EmptyState
            bare
            compact
            icon={<ShieldCheck />}
            title={hooks.length === 0 ? $t("components.hooks-panel.nothingToShowUntilAHook") : $t("components.hooks-panel.nothingDeniedRewrittenOrFailed")}
          />
        ) : (
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH>{$t("components.hooks-panel.when")}</TH>
                <TH>{$t("components.hooks-panel.hook")}</TH>
                <TH>{$t("components.hooks-panel.tool")}</TH>
                <TH>{$t("components.hooks-panel.why")}</TH>
                <TH>{$t("components.hooks-panel.run")}</TH>
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
                        {$t("components.hooks-panel.step", { flow: a.flow, step: String(a.step), agent: a.agent })}
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
