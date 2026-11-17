"use client";

// "Import agent": bring an agent you already have in another workspace of
// this account into this one — its agent.md and own skills/scripts, never
// its memory. POST /api/workspaces/<ws>/agents/import (core agent-import.ts).

import { $t } from "@/i18n";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, labelClass } from "@foldrun/ui/react/input";
import { Select } from "@foldrun/ui/react/select";
import { Dialog, DialogContent, DialogTitle } from "@foldrun/ui/react/dialog";

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
      <button onClick={() => setOpen(true)} className={buttonVariants({ variant: color, size: "md" })}>
        {$t("workspace.agents-import-agent.importAgent")}
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent hideClose aria-describedby={undefined} className="top-[10vh] max-h-[85dvh] translate-y-0 rounded-xl" size="md">
            <form onSubmit={submit} className="flex min-h-0 flex-col">
              <header className="border-b border-line-faint px-5 py-4">
                <DialogTitle className="font-cal text-base font-semibold text-fg">{$t("workspace.agents-import-agent.importAgent")}</DialogTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {$t("workspace.agents-import-agent.copyAnAgentFromAnotherTerm", { workspace: workspace })}
                </p>
              </header>

              {warnings ? (
                <div className="space-y-3 px-5 py-4">
                  <p className="text-sm text-fg">{$t("workspace.agents-import-agent.importedItStillNeeds")}</p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="space-y-4 px-5 py-4">
                  <label className="block space-y-1">
                    <span className={labelClass}>{$t("workspace.agents-import-agent.agent")}</span>
                    {sources === null && !error ? (
                      <p className="text-xs text-fg-muted">{$t("workspace.agents-import-agent.loadingTheAccountSAgents")}</p>
                    ) : sources && sources.length === 0 ? (
                      <p className="text-xs text-fg-muted">{$t("workspace.agents-import-agent.noOtherWorkspaceInThisAccount")}</p>
                    ) : (
                      <Select
                        value={pick}
                        onChange={(e) => setPick(e.target.value)}
                        className="w-full"
                        required
                      >
                        <option value="">{$t("workspace.agents-import-agent.chooseAnAgent")}</option>
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
                      </Select>
                    )}
                  </label>
                  <label className="block space-y-1">
                    <span className={labelClass}>{$t("workspace.agents-import-agent.nameHereOptional")}</span>
                    <Input
                      value={as}
                      onChange={(e) => setAs(e.target.value)}
                      placeholder={pick.split("/")[1] || $t("workspace.agents-import-agent.sameName")}
                    />
                  </label>
                </div>
              )}

              <footer className="flex items-center justify-end gap-2 border-t border-line-faint px-5 py-3">
                {error && <p className="mr-auto text-xs text-red-600">{error}</p>}
                {warnings ? (
                  <button type="button" onClick={close} className={buttonVariants({ variant: "primary", size: "md" })}>
                    {$t("workspace.agents-import-agent.done")}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={close} className={buttonVariants({ variant: "ghost", size: "md" })}>
                      {$t("workspace.agents-import-agent.cancel")}
                    </button>
                    <button type="submit" disabled={busy || !pick} className={buttonVariants({ variant: "primary", size: "md" })}>
                      {busy ? "Importing…" : $t("workspace.agents-import-agent.import")}
                    </button>
                  </>
                )}
              </footer>
            </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
