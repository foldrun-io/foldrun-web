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

import { buttonVariants } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@foldrun/ui/react/link";
import { useRouter } from "next/navigation";
import { Input, Textarea } from "@foldrun/ui/react/input";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@foldrun/ui/react/menu";
import { Segmented } from "@foldrun/ui/react/segmented";
import { IconButton, Tooltip } from "@foldrun/ui/react/tooltip";
import { useCan, needs } from "@/components/role";
import { inputSetsFor, inputsFile, upsertInputSet, type EvalLike, type InputSet } from "@/components/flow-inputs-model";
import { RadioGroup, RadioGroupItem } from "@foldrun/ui/react/choice";
import { Popover, PopoverAnchor, PopoverContent } from "@foldrun/ui/react/popover";
import { RunInputsPicker } from "@/components/run-inputs-picker";

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
  // FOL-163: storage files handed to the run's first step.
  const [files, setFiles] = useState<string[]>([]);

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
        body: JSON.stringify({ ...(task.trim() ? { task: task.trim() } : {}), test: !live, ...(files.length ? { inputs: files } : {}) }),
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
    <Popover open={open} onOpenChange={setOpen} modal={false}>
    <PopoverAnchor asChild>
    <div className="relative inline-flex">
      <div className="inline-flex rounded-md">
        <Tooltip label={mayRun ? "Start this flow with a saved input set" : needs("run:start")}>
          <span className="inline-flex">
            <button
              type="button"
              disabled={!mayRun}
              onClick={() => {
                setOpen((o) => !o);
                setMenu(false);
              }}
              className={buttonVariants({ variant: "secondary", className: "rounded-r-none" })}
            >
              Run with…
            </button>
          </span>
        </Tooltip>
        <Menu open={menu} onOpenChange={setMenu}>
          <MenuTrigger asChild>
            <button
              type="button"
              disabled={!mayRun}
              aria-label="Pick a saved input set"
              className={buttonVariants({ variant: "secondary", size: "icon-sm", className: "-ml-px rounded-l-none" })}
            >
              <ChevronDown aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent className="w-64">
            {sets === null && <p className="px-2 py-1.5 text-[13px] text-fg-subtle">Loading…</p>}
            {sets?.length === 0 && <p className="px-2 py-1.5 text-[13px] text-fg-muted">No saved inputs yet. Open Run with… and save the task you type.</p>}
            {sets?.map((s) => (
              <MenuItem
                key={`${s.file}:${s.name}`}
                onSelect={() => {
                  pick(s);
                  setOpen(true);
                }}
                className="block"
              >
                <span className="block truncate font-medium text-fg">{s.name}</span>
                <span className="block truncate text-[11px] text-fg-muted">{s.task}</span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
    </div>
    </PopoverAnchor>

      <PopoverContent
        align="end"
        aria-label={`Run ${flow} with saved inputs`}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[min(28rem,calc(100vw-2rem))] p-4 text-left"
      >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg">Run {flow} with…</h3>
            <IconButton label="Close" onClick={() => setOpen(false)}>
              <X />
            </IconButton>
          </div>

          <Segmented
            role="radiogroup"
            size="sm"
            label="Input set"
            className="mt-2"
            value={chosen ?? ""}
            onChange={(k) => pick(k ? sets?.find((s) => s.name === k) ?? null : null)}
            items={[
              { key: "", label: "Custom" },
              ...(sets ?? []).map((s) => ({
                key: s.name,
                title: `evals/${s.file}${s.source === "eval" ? " — an eval case for this flow" : ""}`,
                label: (
                  <>
                    {s.name}
                    {s.source === "eval" && <span className="opacity-60">eval</span>}
                  </>
                ),
              })),
            ]}
          />

          <label className="mt-3 block text-xs font-medium text-fg-muted" htmlFor={`task-${flow}`}>
            Task
          </label>
          <Textarea
            id={`task-${flow}`}
            value={task}
            onChange={(e) => {
              setTask(e.target.value);
              setStarted(null);
            }}
            rows={4}
            placeholder="What this run is for — reaches the first step as its task"
            className="mt-1 w-full font-mono text-xs"
          />

          <RunInputsPicker workspace={workspace} tenant={tenant} picked={files} onChange={(p) => { setFiles(p); setStarted(null); }} active={open} />

          <div className="mt-2 flex items-center gap-3 text-xs text-fg-secondary">
            <RadioGroup aria-label="Kind of run" value={live ? "live" : "test"} onValueChange={(v) => setLive(v === "live")} className="flex items-center gap-3">
              <Tooltip label="Every step runs; nothing outward happens and state/ is left alone">
                <label className="flex items-center gap-1.5">
                  <RadioGroupItem value="test" />
                  Test run
                </label>
              </Tooltip>
              <Tooltip label="Does everything the flow does, for real">
                <label className="flex items-center gap-1.5">
                  <RadioGroupItem value="live" />
                  Live run
                </label>
              </Tooltip>
            </RadioGroup>
            <button
              type="button"
              disabled={busy !== null || !mayRun}
              onClick={() => void run()}
              className={cn(buttonVariants({ variant: live ? "danger-outline" : "primary", size: "xs" }), "ml-auto")}
            >
              {busy === "run" ? "Starting…" : live ? "Start live run" : "Start test run"}
            </button>
          </div>

          {started && (
            <p className="mt-2 rounded-md bg-success-soft px-2 py-1.5 text-xs text-success">
              {started.test ? "Test run" : "Live run"} started —{" "}
              <Link href={runHref(started.runId)} className="font-medium underline">
                open {started.runId}
              </Link>
            </p>
          )}

          <div className="mt-3 border-t border-line-faint pt-2">
            <div className="flex items-center gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Name this input set"
                aria-label="Input set name"
                className="min-w-0 flex-1 text-xs"
              />
              <Tooltip label={mayWrite ? `Writes evals/${flow}-inputs.md` : needs("workspace:write")}>
                <span className="inline-flex">
                  <button
                    type="button"
                    disabled={busy !== null || !mayWrite}
                    onClick={() => void save()}
                    className={buttonVariants({ variant: "secondary", size: "md" })}
                  >
                    {busy === "save" ? "Saving…" : "Save current as input set"}
                  </button>
                </span>
              </Tooltip>
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Kept in <span className="font-mono">{inputsFile(flow)}</span> — also{" "}
              <span className="font-mono">foldrun invoke {flow} --inputs &lt;name&gt;</span>.
            </p>
            {saved && <p className="mt-1 text-xs text-success">{saved}</p>}
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {error}
            </p>
          )}
      </PopoverContent>
      {dialog}
    </Popover>
  );
}
