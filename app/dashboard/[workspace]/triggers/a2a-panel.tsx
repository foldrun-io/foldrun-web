"use client";

// A2A on the Triggers page (1 Nov 2026): the other way a flow starts — an
// outside agent calling it over A2A 1.0. What this workspace serves (the
// flows whose frontmatter says `a2a:`, each one's card and endpoint), the
// A2A keys that may call them (an admin's view), and the newest A2A tasks
// with the key that asked and the run that served each. One read: GET
// /api/workspaces/<ws>/a2a. Publishing is on each flow's card (Flows page).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { CopyField } from "@/components/copy-field";
import { LocalTime } from "@/components/local-time";
import { runHref } from "@/components/run-href";
import { a2aStateWord } from "@/components/a2a-model";

interface View {
  flows: { flow: string; published: boolean; publicCard: boolean; name: string; description: string | null; hasInputSchema: boolean; card: string; url: string }[];
  keys: { id: string; label: string; prefix: string; flows: string[]; maxTasks: number | null; expiresAt: string | null }[] | null;
  tasks: { id: string; flow: string; state: string; runId: string | null; contextId: string; key: { id: string; label: string | null; prefix: string | null; revoked: boolean }; createdAt: string; updatedAt: string }[];
}

const TONE: Record<string, "success" | "error" | "warning" | "info" | "default"> = {
  TASK_STATE_COMPLETED: "success",
  TASK_STATE_FAILED: "error",
  TASK_STATE_REJECTED: "error",
  TASK_STATE_CANCELED: "default",
  TASK_STATE_WORKING: "info",
  TASK_STATE_SUBMITTED: "info",
  TASK_STATE_INPUT_REQUIRED: "warning",
  TASK_STATE_AUTH_REQUIRED: "warning",
};

export function A2aPanel({ workspace, tenant }: { workspace: string; tenant: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/a2a`, { headers: tenant !== "default" ? { "x-foldrun-tenant": tenant } : {} }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!live) return;
      if (!res || !res.ok) setError((body as { error?: string }).error ?? `HTTP ${res?.status ?? "—"}`);
      else setView(body as View);
    })();
    return () => {
      live = false;
    };
  }, [workspace, tenant]);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!view) return <p className="text-sm text-fg-subtle">Loading…</p>;
  const flowsHref = `/dashboard/${encodeURIComponent(workspace)}/flows${tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;

  return (
    <div className="space-y-5">
      {view.flows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No flow here says <code className="text-xs">a2a:</code>. Publish one from its card on the <Link href={flowsHref} className="underline">Flows</Link> page (admins), then make an A2A key for it under Settings → API keys.
        </p>
      ) : (
        <ul className="space-y-3">
          {view.flows.map((f) => (
            <li key={f.flow} className="rounded-lg border border-line bg-surface p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                <span className="font-mono">{f.flow}</span>
                {f.name !== f.flow && <span className="text-fg-muted">— {f.name}</span>}
                <Badge variant={f.published ? "success" : "default"}>{f.published ? "published" : "not published"}</Badge>
                {f.publicCard && <Badge title="The card is readable without a key; calling the flow never is">public card</Badge>}
                {f.hasInputSchema && <Badge title="a2a: input: — the request's data part must match this JSON Schema">input schema</Badge>}
              </p>
              {f.description && <p className="mt-1 text-xs text-fg-muted">{f.description}</p>}
              {f.published && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="text-xs text-fg-subtle">
                    Agent card
                    <CopyField value={f.card} className="mt-1" />
                  </div>
                  <div className="text-xs text-fg-subtle">
                    JSON-RPC endpoint
                    <CopyField value={f.url} className="mt-1" />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {view.keys !== null && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">A2A keys for this workspace</h3>
          {view.keys.length === 0 ? (
            <p className="text-sm text-fg-muted">None. Make one under Settings → API keys (A2A key).</p>
          ) : (
            <ul className="divide-y divide-line-faint rounded-lg border border-line">
              {view.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-fg">{k.label || k.prefix}</span>
                  <span className="font-mono text-xs text-fg-subtle">{k.prefix}…</span>
                  <span className="text-xs text-fg-muted">{k.flows.join(", ")}</span>
                  {k.maxTasks !== null && <span className="text-xs text-fg-subtle">· at most {k.maxTasks} open</span>}
                  {k.expiresAt && (
                    <span className="text-xs text-fg-subtle">
                      · expires <LocalTime iso={k.expiresAt} options={{ dateStyle: "medium" }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Recent A2A tasks</h3>
        {view.tasks.length === 0 ? (
          <p className="text-sm text-fg-muted">No outside agent has called a flow here yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Changed</th>
                  <th className="px-3 py-2 font-medium">Flow</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-faint">
                {view.tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      <LocalTime iso={t.updatedAt} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-secondary">{t.flow}</td>
                    <td className="px-3 py-2">
                      <Badge variant={TONE[t.state] ?? "default"}>{a2aStateWord(t.state)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-secondary">
                      {t.key.label || (t.key.prefix ? `${t.key.prefix}…` : "a key")}
                      {t.key.revoked && <span className="ml-1 text-fg-subtle">(revoked)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.runId ? (
                        <Link href={runHref(workspace, t.runId, tenant)} className="font-mono text-fg-secondary underline">
                          {t.runId}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">starting</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
