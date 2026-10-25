// The environments a workspace's agents need, and whether each is built —
// what GET /api/workspaces/<ws>/runtimes answers (and `foldrun deploy`
// polls), on the workspace overview. One row per distinct runtime: its
// packages, the agents that use it, and the last build's outcome, with the
// installer's own error when it failed. A workspace whose agents declare no
// `runtime:` renders nothing.

import { Badge } from "./ui";
import { Panel } from "./mission-control";
import { LocalTime } from "./local-time";

export interface RuntimeRow {
  fingerprint: string;
  agents: string[];
  python: string | boolean | null;
  packages: string[];
  npm: string[];
  /** Debian packages (runtime: system:), apt-installed before the step. */
  system?: string[];
  rejected: string[];
  /** "ready" | "failed" | "building" | "pending" | "on first run" */
  state: string;
  error: string | null;
  at: string | null;
}

const VARIANT: Record<string, "success" | "error" | "info" | "default"> = {
  ready: "success",
  failed: "error",
  building: "info",
  pending: "default",
};

const SAYS: Record<string, string> = {
  ready: "built — runs start with these installed",
  failed: "the last build failed — a run using it will fail the same way",
  building: "building now",
  pending: "waiting for the worker to build it",
  "on first run": "installed when a run first needs it — this server builds no runtime ahead of time",
};

export function RuntimesPanel({ runtimes }: { runtimes: RuntimeRow[] }) {
  if (runtimes.length === 0) return null;
  const failed = runtimes.filter((r) => r.state === "failed").length;
  return (
    <Panel
      title="Runtimes"
      count={runtimes.length}
      className="mb-4"
      action={failed > 0 ? <span className="text-[11px] font-medium text-danger">{failed} failed</span> : undefined}
    >
      <ul className="divide-y divide-line-faint">
        {runtimes.map((r) => (
          <li key={r.fingerprint} className="px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={VARIANT[r.state] ?? "default"} pulse={r.state === "building"}>{r.state}</Badge>
              <span className="min-w-0 truncate font-mono text-xs text-fg">
                {[
                  r.python ? `python${typeof r.python === "string" ? ` ${r.python}` : ""}` : null,
                  ...r.packages,
                  ...r.npm.map((p) => `npm:${p}`),
                  ...(r.system ?? []).map((p) => `apt:${p}`),
                ]
                  .filter(Boolean)
                  .join(" · ") || "no packages"}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
                {r.agents.join(", ")}
                {r.at && <> · <LocalTime iso={r.at} /></>}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">{SAYS[r.state] ?? r.state}</p>
            {r.rejected.length > 0 && (
              <p className="mt-1 text-xs text-warning">
                Not valid requirements, dropped: <span className="font-mono">{r.rejected.join(", ")}</span>
              </p>
            )}
            {r.error && (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-danger-line bg-danger-soft px-2.5 py-1.5 font-mono text-[11px] text-danger">
                {r.error}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
