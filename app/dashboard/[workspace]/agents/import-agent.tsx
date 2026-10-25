"use client";

// "Import agent": bring an agent you already have in another workspace of
// this account into this one — its agent.md and own skills/scripts, never
// its memory. POST /api/workspaces/<ws>/agents/import (core agent-import.ts).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, selectClass, FIELD_LABEL_CLASS } from "@/components/ui";

interface Source {
  name: string;
  agents: { name: string; description: string }[];
}

export function ImportAgentButton({
  tenant,
  workspace,
  color = "secondary",
}: {
  tenant: string;
  workspace: string;
  color?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [pick, setPick] = useState("");
  const [as, setAs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };

  useEffect(() => {
    if (!open || sources) return;
    fetch(`/api/workspaces/${encodeURIComponent(workspace)}/agents/import`, { headers })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setSources(body.workspaces ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    setPick("");
    setAs("");
    setError(null);
    setWarnings(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [from, agent] = pick.split("/");
    if (!from || !agent) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/agents/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ from, agent, ...(as.trim() ? { as: as.trim() } : {}) }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      router.refresh();
      // Say what it still needs before closing — a missing secret is the
      // first thing its first run would trip on.
      if (body.warnings?.length) setWarnings(body.warnings);
      else close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClass(color)}>
        Import agent
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[10vh] backdrop-blur-[2px]"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label="Import agent"
              onSubmit={submit}
              className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl"
            >
              <header className="border-b border-line-faint px-5 py-4">
                <h2 className="font-cal text-base font-semibold text-fg">Import agent</h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Copy an agent from another workspace into {workspace}: its agent.md and its own skills and scripts.
                  Its memory stays where it was learned.
                </p>
              </header>

              {warnings ? (
                <div className="space-y-3 px-5 py-4">
                  <p className="text-sm text-fg">Imported. It still needs:</p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-4 px-5 py-4">
                  <label className="block space-y-1">
                    <span className={FIELD_LABEL_CLASS}>Agent</span>
                    {sources === null && !error ? (
                      <p className="text-xs text-fg-muted">Loading the account&apos;s agents…</p>
                    ) : sources && sources.length === 0 ? (
                      <p className="text-xs text-fg-muted">No other workspace in this account has an agent yet.</p>
                    ) : (
                      <select
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        className={selectClass("w-full")}
                        required
                      >
                        <option value="">Choose an agent…</option>
                        {(sources ?? []).map((s) => (
                          <optgroup key={s.name} label={s.name}>
                            {s.agents.map((a) => (
                              <option key={a.name} value={`${s.name}/${a.name}`}>
                                {a.name}
                                {a.description ? ` — ${a.description.slice(0, 70)}` : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </label>
                  <label className="block space-y-1">
                    <span className={FIELD_LABEL_CLASS}>Name here (optional)</span>
                    <input
                      value={as}
                      onChange={(e) => setAs(e.target.value)}
                      placeholder={pick.split("/")[1] || "same name"}
                      className={inputClass()}
                    />
                  </label>
                </div>
              )}

              <footer className="flex items-center justify-end gap-2 border-t border-line-faint px-5 py-3">
                {error && <p className="mr-auto text-xs text-red-600">{error}</p>}
                {warnings ? (
                  <button type="button" onClick={close} className={buttonClass("primary")}>
                    Done
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={close} className={buttonClass("minimal")}>
                      Cancel
                    </button>
                    <button type="submit" disabled={busy || !pick} className={buttonClass("primary")}>
                      {busy ? "Importing…" : "Import"}
                    </button>
                  </>
                )}
              </footer>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
