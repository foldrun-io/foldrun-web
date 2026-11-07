"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { useCan } from "@/components/role";
import { Checkbox } from "@/components/kit/choice";
import { Tooltip } from "@/components/kit/tooltip";

// Run trigger with an optional task prompt — click Run to reveal the task
// input, submit to start. `withTask={false}` keeps the old one-click behavior.
export function RunButton({
  endpoint,
  tenant,
  label = "Run",
  withTask = true,
}: {
  endpoint: string;
  tenant: string;
  label?: string;
  withTask?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  // A test run: every step runs, nothing outward happens, state/ is left
  // alone. Off by default and reset after each start, so a live run is
  // always a deliberate choice of the moment, never a remembered one.
  const [testRun, setTestRun] = useState(false);
  // A viewer sees the button and cannot press it, with the reason on hover —
  // hiding it would make the page look like running is not a thing here.
  const mayRun = useCan("run:start");

  // A refusal, said where the click happened. The button used to ignore the
  // response entirely, so a run refused for an empty balance, a monthly cap,
  // a suspended account or a quarantined flow looked exactly like a run
  // that started — the page refreshed and nothing appeared. Money refusals
  // carry the one link that fixes them.
  const [refused, setRefused] = useState<{ text: string; status: number } | null>(null);

  const start = async () => {
    setBusy(true);
    setRefused(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ ...(task.trim() ? { task: task.trim() } : {}), ...(testRun ? { test: true } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRefused({ text: body.error ?? `refused (${res.status})`, status: res.status });
        return;
      }
      setOpen(false);
      setTask("");
      setTestRun(false);
      router.refresh();
    } catch (err) {
      setRefused({ text: err instanceof Error ? err.message : "could not start", status: 0 });
    } finally {
      setBusy(false);
    }
  };

  const billingHref = `/dashboard/billing${tenant !== "default" ? `?tenant=${tenant}` : ""}`;
  const refusal = refused && (
    <span role="alert" className="ml-2 inline-flex flex-wrap items-center gap-2 text-xs text-red-600">
      <span>{refused.text}</span>
      {refused.status === 402 && (
        <a href={billingHref} className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium hover:bg-red-100">
          Add credit
        </a>
      )}
      <button type="button" onClick={() => setRefused(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
        ✕
      </button>
    </span>
  );

  if (withTask && open) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <Input
          autoFocus
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task for this run (optional)"
          className="w-56"
        />
        <Tooltip label="Every step runs; sends are refused or sunk, send-capable secrets are withheld, and state/ and storage/ writes are kept under the run instead">
          <label className="flex items-center gap-1.5 text-xs text-fg-tertiary">
            <Checkbox checked={testRun} onCheckedChange={(checked: boolean) => setTestRun(checked)} />
            Test run
          </label>
        </Tooltip>
        <button disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>
          {busy ? "Starting…" : testRun ? "Start test" : "Start"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>
          Cancel
        </button>
        {refusal}
      </form>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center">
      <Tooltip label={mayRun ? undefined : "Your role is viewer — running needs editor or above"}>
        <span className="inline-flex">
          <button
            disabled={!mayRun || busy}
            onClick={() => (withTask ? setOpen(true) : void start())}
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            {busy ? "Starting…" : label}
          </button>
        </span>
      </Tooltip>
      {refusal}
    </span>
  );
}

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
