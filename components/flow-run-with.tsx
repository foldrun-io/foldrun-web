"use client";

// "Run with…" — start a flow with a saved input set.
//
// The sets are markdown in the workspace (see flow-inputs-model.ts): the
// flow's own evals/<flow>-inputs.md, plus every eval case that runs this
// flow, since each of those already carries a `task:`. Picking one fills the
// task; a Test run is the default and a Live run asks first, because a live
// run sends whatever the flow sends. "Save as input set" writes the task in
// the box into the inputs file through the source PUT — a revision like any
// other edit, and the file `foldrun invoke <flow> --inputs <name>` reads.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useCan, needs } from "@/components/role";
import { inputSetsFor, inputsFile, upsertInputSet, type EvalLike, type InputSet } from "@/components/flow-inputs-model";

export function FlowRunWith({ workspace, tenant, flow }: { workspace: string; tenant: string; flow: string }) {
  const router = useRouter();
  const headers = useMemo(() => ({ "x-foldrun-tenant": tenant }), [tenant]);
  const mayRun = useCan("run:start");
  const mayWrite = useCan("workspace:write");
  const [ask, dialog] = useConfirm();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sets, setSets] = useState<InputSet[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [live, setLive] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState<"run" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ runId: string; test: boolean } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // The sets, read fresh each time the menu or the panel opens and after a
  // save: someone may have edited evals/ since.
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => setGeneration((g) => g + 1), []);
  const shown = open || menu;
  useEffect(() => {
    if (!shown) return;
    let live = true;
    fetch(`/api/workspaces/${workspace}/evals`, { headers })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { evals?: EvalLike[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? `could not read evals/ (${res.status})`);
        if (live) setSets(inputSetsFor(body.evals ?? [], flow));
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [shown, workspace, headers, flow, generation]);

  // Click outside closes the menu (not the panel: it holds a typed task).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const pick = (s: InputSet | null) => {
    setChosen(s?.name ?? null);
    setTask(s?.task ?? "");
    setSaveName(s?.source === "inputs" ? s.name : "");
    setStarted(null);
    setSaved(null);
    setError(null);
  };

  const run = async () => {
    setError(null);
    setStarted(null);
    if (live) {
      const ok = await ask({
        title: `Start a live run of ${flow}?`,
        body: "A live run does everything the flow does — it sends, posts and writes state/ for real. A test run runs every step with nothing outward.",
        confirmLabel: "Start live run",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy("run");
    try {
      const res = await fetch(`/api/workspaces/${workspace}/flows/${encodeURIComponent(flow)}/run`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...(task.trim() ? { task: task.trim() } : {}), test: !live }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; test?: boolean; error?: string };
      if (!res.ok || !body.runId) {
        setError(body.error ?? `refused (${res.status})`);
        return;
      }
      setStarted({ runId: body.runId, test: body.test === true });
      setLive(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not start");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setSaved(null);
    const name = saveName.trim();
    if (!name || !task.trim()) {
      setError("A saved set needs a name and a task.");
      return;
    }
    setBusy("save");
    const file = inputsFile(flow);
    try {
      const cur = await fetch(`/api/workspaces/${workspace}/source?path=${encodeURIComponent(file)}`, { headers });
      const curBody = (await cur.json().catch(() => ({}))) as { content?: string; sha256?: string; error?: string };
      const missing = !cur.ok && /not found/i.test(curBody.error ?? "");
      if (!cur.ok && !missing) throw new Error(curBody.error ?? `could not read ${file}`);
      const next = upsertInputSet(missing ? null : (curBody.content ?? ""), flow, name, task);
      const res = await fetch(`/api/workspaces/${workspace}/source`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          path: file,
          content: next,
          message: `input set "${name}" saved for ${flow}`,
          ...(missing ? {} : { ifMatch: curBody.sha256 }),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(res.status === 409 ? `${file} changed while saving — try again` : (body.error ?? `save refused (${res.status})`));
      setSaved(`Saved "${name}" to ${file}`);
      setChosen(name);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runHref = (id: string) => `/dashboard/${workspace}/runs/${id}${tenant !== "default" ? `?tenant=${tenant}` : ""}`;

  return (
    <div ref={box} className="relative inline-flex">
      <div className="inline-flex rounded-md shadow-sm">
        <button
          type="button"
          disabled={!mayRun}
          title={mayRun ? "Start this flow with a saved input set" : needs("run:start")}
          onClick={() => {
            setOpen((o) => !o);
            setMenu(false);
          }}
          className={buttonClass("secondary", "rounded-r-none px-2 py-1 text-xs")}
        >
          Run with…
        </button>
        <button
          type="button"
          disabled={!mayRun}
          aria-label="Pick a saved input set"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
          className={buttonClass("secondary", "-ml-px rounded-l-none px-1.5 py-1 text-xs")}
        >
          ▾
        </button>
      </div>

      {menu && (
        <ul role="menu" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-line bg-surface py-1 text-xs shadow-lg">
          {sets === null && <li className="px-3 py-1.5 text-fg-subtle">Loading…</li>}
          {sets?.length === 0 && (
            <li className="px-3 py-1.5 text-fg-muted">No saved inputs yet. Open Run with… and save the task you type.</li>
          )}
          {sets?.map((s) => (
            <li key={`${s.file}:${s.name}`}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  pick(s);
                  setMenu(false);
                  setOpen(true);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-sunken"
              >
                <span className="block truncate font-medium text-fg">{s.name}</span>
                <span className="block truncate text-[11px] text-fg-muted">{s.task}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={`Run ${flow} with saved inputs`}
          className="absolute right-0 top-full z-30 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-3 text-left shadow-xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-fg">Run {flow} with…</h3>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-fg-subtle hover:text-fg-secondary" aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => pick(null)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${chosen === null ? "border-gray-900 bg-ink text-on-ink" : "border-line text-fg-tertiary hover:bg-sunken"}`}
            >
              Custom
            </button>
            {sets?.map((s) => (
              <button
                key={`${s.file}:${s.name}`}
                type="button"
                onClick={() => pick(s)}
                title={`evals/${s.file}${s.source === "eval" ? " — an eval case for this flow" : ""}`}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${chosen === s.name ? "border-gray-900 bg-ink text-on-ink" : "border-line text-fg-tertiary hover:bg-sunken"}`}
              >
                {s.name}
                {s.source === "eval" && <span className="ml-1 opacity-60">eval</span>}
              </button>
            ))}
          </div>

          <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-fg-subtle" htmlFor={`task-${flow}`}>
            Task
          </label>
          <textarea
            id={`task-${flow}`}
            value={task}
            onChange={(e) => {
              setTask(e.target.value);
              setStarted(null);
            }}
            rows={4}
            placeholder="What this run is for — reaches the first step as its task"
            className={inputClass("mt-1 w-full font-mono text-xs")}
          />

          <fieldset className="mt-2 flex items-center gap-3 text-xs text-fg-secondary">
            <legend className="sr-only">Kind of run</legend>
            <label className="flex items-center gap-1.5" title="Every step runs; nothing outward happens and state/ is left alone">
              <input type="radio" name={`mode-${flow}`} checked={!live} onChange={() => setLive(false)} />
              Test run
            </label>
            <label className="flex items-center gap-1.5" title="Does everything the flow does, for real">
              <input type="radio" name={`mode-${flow}`} checked={live} onChange={() => setLive(true)} />
              Live run
            </label>
            <button
              type="button"
              disabled={busy !== null || !mayRun}
              onClick={() => void run()}
              className={buttonClass(live ? "destructive" : "primary", "ml-auto px-2.5 py-1 text-xs")}
            >
              {busy === "run" ? "Starting…" : live ? "Start live run" : "Start test run"}
            </button>
          </fieldset>

          {started && (
            <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
              {started.test ? "Test run" : "Live run"} started —{" "}
              <Link href={runHref(started.runId)} className="font-medium underline">
                open {started.runId}
              </Link>
            </p>
          )}

          <div className="mt-3 border-t border-line-faint pt-2">
            <div className="flex items-center gap-2">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Name this input set"
                aria-label="Input set name"
                className={inputClass("min-w-0 flex-1 text-xs")}
              />
              <button
                type="button"
                disabled={busy !== null || !mayWrite}
                title={mayWrite ? `Writes evals/${flow}-inputs.md` : needs("workspace:write")}
                onClick={() => void save()}
                className={buttonClass("secondary", "px-2 py-1 text-xs")}
              >
                {busy === "save" ? "Saving…" : "Save current as input set"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Kept in <span className="font-mono">{inputsFile(flow)}</span> — also{" "}
              <span className="font-mono">foldrun invoke {flow} --inputs &lt;name&gt;</span>.
            </p>
            {saved && <p className="mt-1 text-xs text-emerald-700">{saved}</p>}
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}
