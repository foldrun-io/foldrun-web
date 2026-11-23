"use client";

// A2A on the Triggers page (1 Nov 2026): the other way a flow starts — an
// outside agent calling it over A2A 1.0. What this workspace serves (the
// flows whose frontmatter says `a2a:`, each one's card and endpoint), the
// A2A keys that may call them (an admin's view), and the newest A2A tasks
// with the key that asked and the run that served each. One read: GET
// /v1/workspaces/<ws>/a2a. Publishing is on each flow's card (Flows page).

import { $el, $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useEffect, useState } from "react";
import { Chip, EmptyState, Panel } from "@foldrun/ui/react/page";
import { Globe } from "lucide-react";
import { CopyField } from "@/components/copy-field";
import { LocalTime } from "@/components/local-time";
import { runHref } from "@/components/run-href";
import { a2aStateWord } from "@/components/a2a-model";
import { Tooltip } from "@foldrun/ui/react/tooltip";

interface View {
  flows: { flow: string; published: boolean; publicCard: boolean; name: string; description: string | null; hasInputSchema: boolean; card: string; url: string }[];
  keys: { id: string; label: string; prefix: string; flows: string[]; maxTasks: number | null; expiresAt: string | null }[] | null;
  tasks: { id: string; flow: string; state: string; runId: string | null; contextId: string; key: { id: string; label: string | null; prefix: string | null; revoked: boolean }; createdAt: string; updatedAt: string }[];
}

const TONE: Record<string, "good" | "bad" | "warn" | "info" | "default"> = {
  TASK_STATE_COMPLETED: "good",
  TASK_STATE_FAILED: "bad",
  TASK_STATE_REJECTED: "bad",
  TASK_STATE_CANCELED: "default",
  TASK_STATE_WORKING: "info",
  TASK_STATE_SUBMITTED: "info",
  TASK_STATE_INPUT_REQUIRED: "warn",
  TASK_STATE_AUTH_REQUIRED: "warn",
};

export function A2aPanel({ workspace, tenant }: { workspace: string; tenant: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/a2a`, { headers: tenant !== "default" ? { "x-foldrun-tenant": tenant } : {} }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!live) return;
      if (!res || !res.ok) setError((body as { error?: string }).error ?? `HTTP ${res?.status ?? "—"}`);
      else setView(body as View);
    })();
    return () => {
      live = false;
    };
  }, [workspace, tenant]);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!view) return <p className="text-sm text-fg-subtle">{$t("workspace.triggers-a2a-panel.loading")}</p>;
  const flowsHref = `/dashboard/${encodeURIComponent(workspace)}/flows${tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;

  return (
    <div className="space-y-8">
      <Panel
        title={$t("workspace.triggers-a2a-panel.flowsServedOverA2a")}
        description={$t("workspace.triggers-a2a-panel.flowsPublishedWithA2aCanBe")}
        flush
      >
        {view.flows.length === 0 ? (
          <EmptyState
            bare
            compact
            icon={<Globe />}
            title={$t("workspace.triggers-a2a-panel.noFlowHereSaysA2a")}
            description={
              <>
                {$rich("workspace.triggers-a2a-panel.publishOneFromItsSettingsTab", { link: (chunks) => <Link href={flowsHref} className="text-link hover:underline">{chunks}</Link> })}
              </>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {view.flows.map((f) => (
              <li key={f.flow} className="px-5 py-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  <span className="font-mono">{f.flow}</span>
                  {f.name !== f.flow && <span className="font-normal text-fg-muted">— {f.name}</span>}
                  <Chip tone={f.published ? "good" : "default"}>{f.published ? "published" : $t("workspace.triggers-a2a-panel.notPublished")}</Chip>
                  {f.publicCard && <Tooltip label={$t("workspace.triggers-a2a-panel.theCardIsReadableWithoutA")}><span><Chip>{$t("workspace.triggers-a2a-panel.publicCard")}</Chip></span></Tooltip>}
                  {f.hasInputSchema && <Tooltip label={$t("workspace.triggers-a2a-panel.a2aInputTheRequestSData")}><span><Chip>{$t("workspace.triggers-a2a-panel.inputSchema")}</Chip></span></Tooltip>}
                </p>
                {f.description && <p className="mt-1 text-sm text-fg-muted">{f.description}</p>}
                {f.published && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="text-xs text-fg-muted">
                      {$rich("workspace.triggers-a2a-panel.agentCard", { copyField: $el(<CopyField value={f.card} className="mt-1" />) })}
                    </div>
                    <div className="text-xs text-fg-muted">
                      {$rich("workspace.triggers-a2a-panel.jsonRpcEndpoint", { copyField: $el(<CopyField value={f.url} className="mt-1" />) })}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {view.keys !== null && (
        <Panel title={$t("workspace.triggers-a2a-panel.a2aKeysForThisWorkspace")} flush>
          {view.keys.length === 0 ? (
            <EmptyState bare compact title={$t("workspace.triggers-a2a-panel.noA2aKeys")} description={$t("workspace.triggers-a2a-panel.makeOneUnderSettingsApiKeys")} />
          ) : (
            <ul className="divide-y divide-line">
              {view.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                  <span className="font-medium text-fg">{k.label || k.prefix}</span>
                  <span className="font-mono text-xs text-fg-muted">{k.prefix}…</span>
                  <span className="text-fg-secondary">{k.flows.join(", ")}</span>
                  {k.maxTasks !== null && <span className="text-fg-muted">{$t("workspace.triggers-a2a-panel.atMostOpen", { maxTasks: String(k.maxTasks) })}</span>}
                  {k.expiresAt && (
                    <span className="text-fg-muted">
                      {$rich("workspace.triggers-a2a-panel.expires", { localTime: $el(<LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} />) })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title={$t("workspace.triggers-a2a-panel.recentA2aTasks")} flush>
        {view.tasks.length === 0 ? (
          <EmptyState bare compact title={$t("workspace.triggers-a2a-panel.noTasksYet")} description={$t("workspace.triggers-a2a-panel.noOutsideAgentHasCalledA")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line bg-sunken text-left text-[13px] text-fg-muted">
                <tr>
                  <th className="h-10 px-4 font-medium">{$t("workspace.triggers-a2a-panel.changed")}</th>
                  <th className="h-10 px-4 font-medium">{$t("workspace.triggers-a2a-panel.flow")}</th>
                  <th className="h-10 px-4 font-medium">{$t("workspace.triggers-a2a-panel.state")}</th>
                  <th className="h-10 px-4 font-medium">{$t("workspace.triggers-a2a-panel.key")}</th>
                  <th className="h-10 px-4 font-medium">{$t("workspace.triggers-a2a-panel.run")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {view.tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-fg-muted">
                      <LocalTime iso={t.updatedAt} />
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] text-fg-secondary">{t.flow}</td>
                    <td className="px-4 py-3">
                      <Chip tone={TONE[t.state] ?? "default"}>{a2aStateWord(t.state)}</Chip>
                    </td>
                    <td className="px-4 py-3 text-fg-secondary">
                      {t.key.label || (t.key.prefix ? `${t.key.prefix}…` : $t("workspace.triggers-a2a-panel.aKey"))}
                      {t.key.revoked && <span className="ml-1 text-fg-muted">{$t("workspace.triggers-a2a-panel.revoked")}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {t.runId ? (
                        <Link href={runHref(workspace, t.runId, tenant)} className="font-mono text-[13px] text-link hover:underline">
                          {t.runId}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">{$t("workspace.triggers-a2a-panel.starting")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
