"use client";

import { $el, $rich, $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { useCan } from "@/components/role";
import { Checkbox } from "@foldrun/ui/react/choice";
import { Tooltip } from "@foldrun/ui/react/tooltip";
import { Textarea } from "@foldrun/ui/react/input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@foldrun/ui/react/dialog";
import { runBodyOf, runPageOf } from "@/components/run-button-model";

// Run trigger with an optional task prompt — click Run to reveal the task
// input, submit to start. `withTask={false}` keeps the old one-click behavior.
// `dialog` asks for the task in a dialog instead of inline (an agent's row has
// no room for a field). A started run opens its page, so the click is seen.
export function RunButton({
  endpoint,
  tenant,
  label = $t("dashboard.run-button.run"),
  withTask = true,
  dialog = false,
}: {
  endpoint: string;
  tenant: string;
  label?: string;
  withTask?: boolean;
  dialog?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  // A test run: every step runs, nothing outward happens, state/ is left
  // alone. Off by default and reset after each start, so a live run is
  // always a deliberate choice of the moment, never a remembered one.
  const [testRun, setTestRun] = useState(false);
  // The run just started, until its page opens: the button stays down, so a
  // second click cannot start a second run.
  const [started, setStarted] = useState<string | null>(null);
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
        body: JSON.stringify(runBodyOf(task, testRun)),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRefused({ text: body.error ?? $t("dashboard.run-button.refused", { status: String(res.status) }), status: res.status });
        return;
      }
      const answer = (await res.json().catch(() => ({}))) as { runId?: string };
      setOpen(false);
      setTask("");
      setTestRun(false);
      const page = runPageOf(endpoint, answer.runId, tenant);
      if (page) {
        setStarted(answer.runId as string);
        router.push(page);
        return;
      }
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
          {$t("dashboard.run-button.addCredit")}
        </a>
      )}
      <button type="button" onClick={() => setRefused(null)} aria-label={$t("dashboard.run-button.dismiss")} className="opacity-60 hover:opacity-100">
        ✕
      </button>
    </span>
  );

  if (withTask && dialog) {
    return (
      <span className="inline-flex flex-wrap items-center">
        <Tooltip label={mayRun ? undefined : $t("dashboard.run-button.yourRoleIsViewerRunningNeeds")}>
          <span className="inline-flex">
            <button disabled={!mayRun || busy || started !== null} onClick={() => setOpen(true)} className={buttonVariants({ variant: "secondary", size: "md" })}>
              {started ? $t("dashboard.run-button.runStarted") : label}
            </button>
          </span>
        </Tooltip>
        <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent size="md">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <DialogHeader>
                <DialogTitle>{$t("dashboard.run-button.runWith")}</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <Textarea autoFocus rows={4} value={task} onChange={(e) => setTask(e.target.value)} placeholder={$t("dashboard.run-button.taskForThisRunOptional")} />
                <Tooltip label={$t("dashboard.run-button.everyStepRunsSendsAreRefused")}>
                  <label className="mt-3 flex items-center gap-1.5 text-xs text-fg-tertiary">
                    {$rich("dashboard.run-button.testRun", { checkbox: $el(<Checkbox checked={testRun} onCheckedChange={(checked: boolean) => setTestRun(checked)} />) })}
                  </label>
                </Tooltip>
                {refusal && <div className="mt-3">{refusal}</div>}
              </DialogBody>
              <DialogFooter>
                <button type="button" disabled={busy} onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>
                  {$t("dashboard.run-button.cancel")}
                </button>
                <button disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>
                  {busy ? $t("dashboard.run-button.starting") : testRun ? $t("dashboard.run-button.startTest") : $t("dashboard.run-button.start")}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </span>
    );
  }

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
          placeholder={$t("dashboard.run-button.taskForThisRunOptional")}
          className="w-56"
        />
        <Tooltip label={$t("dashboard.run-button.everyStepRunsSendsAreRefused")}>
          <label className="flex items-center gap-1.5 text-xs text-fg-tertiary">
            {$rich("dashboard.run-button.testRun", { checkbox: $el(<Checkbox checked={testRun} onCheckedChange={(checked: boolean) => setTestRun(checked)} />) })}
          </label>
        </Tooltip>
        <button disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>
          {busy ? $t("dashboard.run-button.starting") : testRun ? $t("dashboard.run-button.startTest") : $t("dashboard.run-button.start")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonVariants({ variant: "ghost", size: "md" })}>
          {$t("dashboard.run-button.cancel")}
        </button>
        {refusal}
      </form>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center">
      <Tooltip label={mayRun ? undefined : $t("dashboard.run-button.yourRoleIsViewerRunningNeeds")}>
        <span className="inline-flex">
          <button
            disabled={!mayRun || busy || started !== null}
            onClick={() => (withTask ? setOpen(true) : void start())}
            className={buttonVariants({ variant: "secondary", size: "md" })}
          >
            {busy ? $t("dashboard.run-button.starting") : started ? $t("dashboard.run-button.runStarted") : label}
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
