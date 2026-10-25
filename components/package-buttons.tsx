"use client";

// Export and import a workspace, a flow or an agent as a .zip.
//
//   ExportLink           GET /api/workspaces/<ws>/export[?kind=&name=] — a download
//   ImportPackageButton  POST /api/workspaces/<ws>/import?dryRun=1 to preview,
//                        then POST …/import[?overwrite=1] to apply
//
// The preview is the point: it says what the package adds, what it would
// overwrite (only with a tick), and what it names that this account lacks —
// secrets, library tools, an agent it consults — before anything is written.
// See core package.ts.

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { suggestName } from "@/components/package-name";

export function ExportLink({
  workspace,
  kind = "workspace",
  name,
  label = "Export",
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
    <a
      href={`/api/workspaces/${encodeURIComponent(workspace)}/export${qs}`}
      download
      className={className ?? buttonClass("secondary")}
      title={
        kind === "workspace"
          ? "Download this workspace's agents, flows, tools and knowledge as a .zip — never memory, state or secret values"
          : `Download this ${kind} and what it needs to run as a .zip`
      }
    >
      {label}
    </a>
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
  const input = useRef<HTMLInputElement>(null);
  // In the browser only: the dialog is portalled to document.body, and with
  // autoOpen (/dashboard?import=workspace) it is open on the server's render,
  // where there is no document — that render 500'd before this.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);

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
    if (!file) throw new Error("choose a .zip first");
    const r = await fetch(`/api/workspaces/${encodeURIComponent(target)}/import${query}`, {
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
        ["Secrets to set", p.needs.secrets],
        ["Tools not in this workspace or the library", p.needs.tools],
        ["Skills not found", p.needs.skills],
        ["Scripts not found", p.needs.scripts],
        ["Agents it names that are not here", p.needs.agents],
        ["Flows it runs that are not here", p.needs.flows],
      ] as const
    ).filter(([, v]) => v.length > 0);

  const what = (p: Plan) => (p.kind === "workspace" ? "workspace" : `${p.kind} ${p.name}`) + (p.from ? ` from ${p.from}` : "");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(color)}>
        {label ?? (newWorkspace ? "Import workspace" : "Import .zip")}
      </button>
      {open &&
        inBrowser &&
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
              aria-label="Import a package"
              onSubmit={preview}
              className="w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl"
            >
              <header className="border-b border-line-faint px-5 py-4">
                <h2 className="font-cal text-base font-semibold text-fg">
                  {newWorkspace ? "Import a workspace" : `Import into ${workspace}`}
                </h2>
                <p className="mt-0.5 text-xs text-fg-muted">
                  A .zip from Export — a workspace, a flow or an agent, from this account or another. You see what it adds and
                  needs before anything is written. Nothing is deleted.
                </p>
              </header>

              <div className="space-y-4 px-5 py-4">
                {done ? (
                  <div className="space-y-2">
                    <p className="text-sm text-fg">
                      Imported {what(done)} into <span className="font-mono">{done.workspace}</span>: {done.written?.length ?? 0}{" "}
                      file{done.written?.length === 1 ? "" : "s"} written.
                    </p>
                    {needsList(done).length > 0 && <NeedsBlock items={needsList(done)} />}
                  </div>
                ) : plan ? (
                  <div className="space-y-3 text-sm">
                    <p className="text-fg">
                      {what(plan)} → <span className="font-mono">{plan.workspace}</span>
                      {plan.creates && <span className="ml-1 text-xs text-fg-muted">(a new workspace)</span>}
                    </p>
                    <ul className="space-y-1 text-xs text-fg-secondary">
                      <li>
                        <b>{plan.added.length}</b> new file{plan.added.length === 1 ? "" : "s"}
                      </li>
                      {plan.unchanged.length > 0 && <li>{plan.unchanged.length} already identical — left alone</li>}
                      {(plan.skipped?.length ?? 0) > 0 && (
                        <li title={plan.skipped!.join("\n")}>
                          {plan.skipped!.length} not imported — memory, state and anything outside agents, flows, evals, knowledge, skills, tools
                          and scripts
                        </li>
                      )}
                      {plan.overwritten.length > 0 && (
                        <li className="text-amber-700 dark:text-amber-400">
                          {plan.overwritten.length} file{plan.overwritten.length === 1 ? "" : "s"} here would be replaced:
                          <ul className="mt-1 list-disc pl-5 font-mono">
                            {plan.overwritten.slice(0, 12).map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                            {plan.overwritten.length > 12 && <li>… {plan.overwritten.length - 12} more</li>}
                          </ul>
                        </li>
                      )}
                    </ul>
                    {plan.overwritten.length > 0 && (
                      <label className="flex items-center gap-2 text-xs text-fg-secondary">
                        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                        Replace {plan.overwritten.length === 1 ? "that file" : `those ${plan.overwritten.length} files`} (History can restore {plan.overwritten.length === 1 ? "it" : "them"})
                      </label>
                    )}
                    {needsList(plan).length > 0 && <NeedsBlock items={needsList(plan)} />}
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={FIELD_LABEL_CLASS} htmlFor="pkg-file">
                        Package
                      </label>
                      <input
                        id="pkg-file"
                        ref={input}
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setFile(f);
                          // `blog.zip` → offer `blog` as the new workspace's name.
                          if (newWorkspace && f && !target) setTarget(suggestName(f.name));
                        }}
                        className="mt-1 block w-full text-sm text-fg-secondary file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
                      />
                    </div>
                    {newWorkspace && (
                      <div>
                        <label className={FIELD_LABEL_CLASS} htmlFor="pkg-target">
                          Workspace name
                        </label>
                        <input
                          id="pkg-target"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          placeholder="marketing"
                          className={inputClass("mt-1 w-full font-mono")}
                        />
                        <p className="mt-1 text-[11px] text-fg-subtle">A new name makes a new workspace; an existing one imports into it.</p>
                      </div>
                    )}
                  </>
                )}
                {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
              </div>

              <footer className="flex justify-end gap-2 border-t border-line-faint px-5 py-3">
                <button type="button" onClick={close} className={buttonClass("secondary")}>
                  {done ? "Close" : "Cancel"}
                </button>
                {!done &&
                  (plan ? (
                    <button
                      type="button"
                      onClick={apply}
                      // An import that would replace files waits for the tick —
                      // the server refuses it (409) otherwise.
                      disabled={busy || (plan.overwritten.length > 0 && !overwrite) || plan.added.length + plan.overwritten.length === 0}
                      className={buttonClass("primary")}
                    >
                      {busy ? "Importing…" : plan.added.length + plan.overwritten.length === 0 ? "Nothing to import" : "Import"}
                    </button>
                  ) : (
                    <button type="submit" disabled={busy || !file || !target.trim()} className={buttonClass("primary")}>
                      {busy ? "Reading…" : "Preview"}
                    </button>
                  ))}
              </footer>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

const noop = () => () => {};

function NeedsBlock({ items }: { items: (readonly [string, readonly string[]])[] }) {
  return (
    <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs">
      <p className="font-medium text-fg-secondary">It still needs:</p>
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
