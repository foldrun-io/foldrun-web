"use client";

// "Does this tool actually work?"
//
// Before this, the answer arrived mid-flow: the agent would quietly not use the
// tool and say something plausible instead, and you'd go looking for a bug in
// the prompt. A wrong base URL, an unset secret and a typo'd script path all
// look identical from the outside.
//
// So the button really calls it — a real request, a real process, a real MCP
// handshake — and shows what came back, including *which* secrets are unset.
// Never their values.

import { useState } from "react";
import { Check, Play, X } from "lucide-react";
import { Button } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { Tooltip } from "@/components/kit/tooltip";
import { Callout } from "@/components/kit/page";

interface Result {
  ok: boolean;
  transport: "http" | "script" | "mcp";
  summary: string;
  detail: string;
  ms: number;
  missingSecrets: string[];
}

export function ToolTest({
  workspace,
  tenant,
  tool,
  /** http tools get a path box: `base:` alone is often not a real endpoint. */
  transport,
  /** script tools get one box per declared arg — a script that needs `--title`
   *  and is called without it hasn't failed, it hasn't been tested. */
  scriptArgs = [],
  stale = false,
}: {
  workspace: string;
  tenant: string;
  tool: string;
  transport: "http" | "script" | "mcp" | null;
  scriptArgs?: string[];
  /** The editor above has unsaved changes. A test runs the file on disk, so
   *  without this the loop went: edit, Test, "still broken", five minutes of
   *  staring — because the fix was never saved. */
  stale?: boolean;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [probePath, setProbePath] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/workspaces/${workspace}/tools/${tool}/test`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ path: probePath, args }),
      });
      const data = await res.json();
      setResult(
        res.ok
          ? data
          : { ok: false, transport: transport ?? "http", summary: data.error ?? `${res.status}`, detail: "", ms: 0, missingSecrets: [] },
      );
    } catch (err) {
      setResult({
        ok: false,
        transport: transport ?? "http",
        summary: err instanceof Error ? err.message : String(err),
        detail: "",
        ms: 0,
        missingSecrets: [],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {transport === "script" && scriptArgs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {scriptArgs.map((a) => (
            <label key={a} className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-fg-muted">--{a}</span>
              <Input
                value={args[a] ?? ""}
                onChange={(e) => setArgs((prev) => ({ ...prev, [a]: e.target.value }))}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {transport === "http" && (
          <Input
            value={probePath}
            onChange={(e) => setProbePath(e.target.value)}
            placeholder="/path to try"
            aria-label="Path to try"
            spellCheck={false}
            className="w-56 font-mono text-[13px]"
          />
        )}
        <Tooltip label={stale ? "Save first — a test runs the file on disk, not the text on screen" : undefined}>
          <span className="inline-flex">
            <Button
              variant="primary"
              size="md"
              onClick={run}
              disabled={busy || stale}
            >
              <Play /> {busy ? "Calling…" : "Test"}
            </Button>
          </span>
        </Tooltip>
        {stale && (
          <span className="text-xs text-warning">Save first — the test runs what is on disk.</span>
        )}
      </div>

      {result && (
        <p className={`flex items-start gap-1.5 text-sm font-medium ${result.ok ? "text-success" : "text-danger"}`}>
          {result.ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span className="min-w-0 break-words">
            {result.summary}
            <span className="ml-1.5 font-normal text-fg-subtle">{result.ms}ms</span>
          </span>
        </p>
      )}

      {result?.missingSecrets.length ? (
        <Callout tone="warning" className="px-3 py-2 text-xs">
          Unset secret{result.missingSecrets.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono">{result.missingSecrets.join(", ")}</span> — the call went out
          without {result.missingSecrets.length === 1 ? "it" : "them"}.
        </Callout>
      ) : null}

      {result?.detail ? (
        <pre className="max-h-80 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">
          {result.detail}
        </pre>
      ) : null}
    </div>
  );
}
