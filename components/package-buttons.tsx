"use client";

// Export and import a workspace, a flow or an agent as a .zip.
//
//   ExportLink           GET /v1/workspaces/<ws>/export[?kind=&name=] — a download
//   ImportPackageButton  POST /v1/workspaces/<ws>/import?dryRun=1 to preview,
//                        then POST …/import[?overwrite=1] to apply
//
// The preview is the point: it says what the package adds, what it would
// overwrite (only with a tick), and what it names that this account lacks —
// secrets, library tools, an agent it consults — before anything is written.
// See core package.ts.

import { $el, $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input, labelClass } from "@foldrun/ui/react/input";
import { suggestName } from "@/components/package-name";
import { Checkbox } from "@foldrun/ui/react/choice";
import { FileButton } from "@foldrun/ui/react/file-button";
import { Dialog, DialogContent, DialogTitle } from "@foldrun/ui/react/dialog";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export function ExportLink({
  workspace,
  kind = "workspace",
  name,
  label = $t("components.package-buttons.export"),
  className,
}: {
  workspace: string;
  kind?: "workspace" | "flow" | "agent";
  name?: string;
  label?: string;
  className?: string;
}) {
  const qs = kind === "workspace" ? "" : `?kind=${kind}&name=${encodeURIComponent(name ?? "")}`;
  return (
    <Tooltip
      label={
        kind === "workspace"
          ? $t("components.package-buttons.downloadThisWorkspaceSAgentsFlows")
          : $t("components.package-buttons.downloadThisAndWhatItNeeds", { kind: String(kind) })
      }
    >
      <a
        href={`/v1/workspaces/${encodeURIComponent(workspace)}/export${qs}`}
        download
        className={className ?? buttonVariants({ variant: "secondary", size: "md" })}
      >
        {label}
      </a>
    </Tooltip>
  );
}

interface Plan {
  kind: "workspace" | "flow" | "agent";
  name: string;
  from: string;
  workspace: string;
  creates: boolean;
  added: string[];
  overwritten: string[];
  unchanged: string[];
  needs: { secrets: string[]; tools: string[]; skills: string[]; scripts: string[]; agents: string[]; flows: string[] };
  skipped?: string[];
  written?: string[];
}

export function ImportPackageButton({
  tenant,
  workspace,
  newWorkspace = false,
  label,
  color = "secondary",
  autoOpen = false,
}: {
  tenant: string;
  /** Where it goes. Ignored with `newWorkspace`, which asks for a name. */
  workspace?: string;
  newWorkspace?: boolean;
  label?: string;
  color?: "primary" | "secondary";
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(workspace ?? "");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Plan | null>(null);

  const close = () => {
    setOpen(false);
    setFile(null);
    setPlan(null);
    setOverwrite(false);
    setError(null);
    setDone(null);
    if (!newWorkspace) setTarget(workspace ?? "");
  };

  const send = async (query: string): Promise<Plan> => {
    if (!file) throw new Error($t("components.package-buttons.chooseAZipFirst"));
    const r = await fetch(`/v1/workspaces/${encodeURIComponent(target)}/import${query}`, {
      method: "POST",
      headers: { "content-type": "application/zip", "x-foldrun-tenant": tenant },
      body: file,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
    return body as Plan;
  };

  const preview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await send("?dryRun=1");
      setPlan(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send(overwrite ? "?overwrite=1" : "");
      setDone(r);
      setPlan(null);
      if (r.creates) router.push(`/dashboard/${encodeURIComponent(r.workspace)}${tenant !== "default" ? `?tenant=${tenant}` : ""}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const needsList = (p: Plan) =>
    (
      [
        [$t("components.package-buttons.secretsToSet"), p.needs.secrets],
        [$t("components.package-buttons.toolsNotInThisWorkspaceOr"), p.needs.tools],
        [$t("components.package-buttons.skillsNotFound"), p.needs.skills],
        [$t("components.package-buttons.scriptsNotFound"), p.needs.scripts],
        [$t("components.package-buttons.agentsItNamesThatAreNot"), p.needs.agents],
        [$t("components.package-buttons.flowsItRunsThatAreNot"), p.needs.flows],
      ] as const
    ).filter(([, v]) => v.length > 0);

  const what = (p: Plan) => $t("components.package-buttons.what", { whole: p.kind === "workspace" ? "yes" : "no", kind: p.kind, name: p.name ?? "", hasFrom: p.from ? "yes" : "no", from: p.from ?? "" });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonVariants({ variant: color, size: "md" })}>
        {label ?? (newWorkspace ? $t("components.package-buttons.importWorkspace") : $t("components.package-buttons.importZip"))}
      </button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent hideClose aria-describedby={undefined} className="top-[10vh] max-h-[85dvh] translate-y-0 rounded-xl" size="md">
            <form onSubmit={preview} className="flex min-h-0 flex-col">
              <header className="border-b border-line-faint px-5 py-4">
                <DialogTitle className="font-cal text-base font-semibold text-fg">
                  {newWorkspace ? $t("components.package-buttons.importAWorkspace") : $t("components.package-buttons.importInto", { workspace: String(workspace) })}
                </DialogTitle>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {$t("components.package-buttons.aZipFromExportAWorkspace")}
                </p>
              </header>

              <div className="space-y-4 px-5 py-4">
                {done ? (
                  <div className="space-y-2">
                    <p className="text-sm text-fg">
                      {$rich("components.package-buttons.importedIntoFileWritten", { done: what(done), workspace: done.workspace, span: (chunks) => <span className="font-mono">{chunks}</span>, length: String(done.written?.length ?? 0), length2: done.written?.length ?? "" })}
                    </p>
                    {needsList(done).length > 0 && <NeedsBlock items={needsList(done)} />}
                  </div>
                ) : plan ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-fg">
                      {what(plan)} → <span className="font-mono">{plan.workspace}</span>
                      {plan.creates && <span className="ms-1 text-xs text-fg-muted">{$t("components.package-buttons.aNewWorkspace")}</span>}
                    </p>
                    <ul className="space-y-1 text-xs text-fg-secondary">
                      <li>
                        {$rich("components.package-buttons.newFile", { length: plan.added.length, b: (chunks) => <b>{chunks}</b> })}
                      </li>
                      {plan.unchanged.length > 0 && <li>{$t("components.package-buttons.alreadyIdenticalLeftAlone", { length: String(plan.unchanged.length) })}</li>}
                      {(plan.skipped?.length ?? 0) > 0 && (
                        <Tooltip label={<span className="whitespace-pre-line">{plan.skipped!.join("\n")}</span>}>
                          <li>
                            {$t("components.package-buttons.notImportedMemoryStateAndAnything", { length: String(plan.skipped!.length) })}
                          </li>
                        </Tooltip>
                      )}
                      {plan.overwritten.length > 0 && (
                        <li className="text-amber-700 dark:text-amber-400">
                          {$t("components.package-buttons.fileHereWouldBeReplaced", { length: plan.overwritten.length })}
                          <ul className="mt-1 list-disc ps-5 font-mono">
                            {plan.overwritten.slice(0, 12).map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                            {plan.overwritten.length > 12 && <li>{$t("components.package-buttons.more", { length: String(plan.overwritten.length - 12) })}</li>}
                          </ul>
                        </li>
                      )}
                    </ul>
                    {plan.overwritten.length > 0 && (
                      <label className="flex items-center gap-2 text-xs text-fg-secondary">
                        {$rich("components.package-buttons.replaceFiles", { n: plan.overwritten.length, checkbox: $el(<Checkbox checked={overwrite} onCheckedChange={(checked: boolean) => setOverwrite(checked)} />) })}
                      </label>
                    )}
                    {needsList(plan).length > 0 && <NeedsBlock items={needsList(plan)} />}
                  </div>
                ) : (
                  <>
                    <div>
                      <span className={labelClass} id="pkg-file-label">
                        {$t("components.package-buttons.package")}
                      </span>
                      <div className="mt-1">
                        <FileButton
                          id="pkg-file"
                          aria-labelledby="pkg-file-label pkg-file"
                          accept=".zip,application/zip"
                          chosen={file ? file.name : $t("components.package-buttons.noFileChosen")}
                          onFiles={([f]) => {
                            setFile(f);
                            // `blog.zip` → offer `blog` as the new workspace's name.
                            if (newWorkspace && f && !target) setTarget(suggestName(f.name));
                          }}
                        >
                          {$t("components.package-buttons.chooseAZip")}
                        </FileButton>
                      </div>
                    </div>
                    {newWorkspace && (
                      <div>
                        <label className={labelClass} htmlFor="pkg-target">
                          {$t("components.package-buttons.workspaceName")}
                        </label>
                        <Input
                          id="pkg-target"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          placeholder="marketing"
                          className="mt-1 w-full font-mono"
                        />
                        <p className="mt-1 text-[11px] text-fg-subtle">{$t("components.package-buttons.aNewNameMakesANew")}</p>
                      </div>
                    )}
                  </>
                )}
                {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
              </div>

              <footer className="flex justify-end gap-2 border-t border-line-faint px-5 py-3">
                <button type="button" onClick={close} className={buttonVariants({ variant: "secondary", size: "md" })}>
                  {done ? $t("components.package-buttons.close") : $t("components.package-buttons.cancel")}
                </button>
                {!done &&
                  (plan ? (
                    <button
                      type="button"
                      onClick={apply}
                      // An import that would replace files waits for the tick —
                      // the server refuses it (409) otherwise.
                      disabled={busy || (plan.overwritten.length > 0 && !overwrite) || plan.added.length + plan.overwritten.length === 0}
                      className={buttonVariants({ variant: "primary", size: "md" })}
                    >
                      {busy ? $t("components.package-buttons.importing") : plan.added.length + plan.overwritten.length === 0 ? $t("components.package-buttons.nothingToImport") : $t("components.package-buttons.import")}
                    </button>
                  ) : (
                    <button type="submit" disabled={busy || !file || !target.trim()} className={buttonVariants({ variant: "primary", size: "md" })}>
                      {busy ? $t("components.package-buttons.reading") : $t("components.package-buttons.preview")}
                    </button>
                  ))}
              </footer>
            </form>
        </DialogContent>
      </Dialog>
    </>
  );
}


function NeedsBlock({ items }: { items: (readonly [string, readonly string[]])[] }) {
  return (
    <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs">
      <p className="font-medium text-fg-secondary">{$t("components.package-buttons.itStillNeeds")}</p>
      <ul className="mt-1 space-y-0.5 text-fg-tertiary">
        {items.map(([k, v]) => (
          <li key={k}>
            {k}: <span className="font-mono">{v.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
