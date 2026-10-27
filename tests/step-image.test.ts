// The run page says which image a step ran on, and what happened to the
// browser pod: reconnects, a re-run on full, or the failure after a write.

import test from "node:test";
import assert from "node:assert/strict";
import { stepImage, stepHeld, browserPodNote, podTries, browserPodPanel, stepCredential, stepStartup, stepRefused } from "../components/step-image-model.ts";
import { resourcesLabel } from "../components/editor-context-model.ts";

test("the chip: slim through the pod, slim, full, or nothing on a record from before", () => {
  assert.deepEqual(stepImage({ image: { variant: "slim", why: "browses through the account's browser pod", pod: true } }), {
    label: "slim · browser pod",
    title: "runner image: slim — browses through the account's browser pod",
  });
  assert.equal(stepImage({ image: { variant: "slim" } })?.label, "slim");
  assert.match(stepImage({ image: { variant: "slim" } })!.title, /no browser in the step/);
  assert.deepEqual(stepImage({ image: { variant: "full", why: "re-run after the browser pod was lost" } }), {
    label: "full",
    title: "runner image: full — re-run after the browser pod was lost",
  });
  assert.equal(stepImage({}), null);
  assert.equal(stepImage({ image: null }), null);
});

test("the note: quiet when nothing happened; reconnects; re-ran on full; failed after a write", () => {
  assert.equal(browserPodNote({ browserPod: { reconnects: 0, reconnected: 0 } }), null);
  assert.equal(browserPodNote({}), null);
  assert.deepEqual(browserPodNote({ browserPod: { reconnects: 1, reconnected: 1 } }), { line: "1 reconnect (1 got through)", tone: "ok" });
  const rerun = browserPodNote({ browserPod: { reconnects: 3, reconnected: 0, lost: { cause: "lost", detail: "ECONNREFUSED" }, writes: [], fallback: "browser pod lost; re-ran on full" } });
  assert.equal(rerun?.tone, "warn");
  assert.equal(rerun?.line, "3 reconnects; browser pod lost; re-ran on full (ECONNREFUSED)");
  // run-mupfupae-h2jj, 2026-10-01: the reconnect reached the pod as it shut
  // down and the call dropped again — not "1 got through".
  const closed = browserPodNote({ browserPod: { reconnects: 1, reconnected: 0, closedAgain: 1, lost: { cause: "lost", detail: "browser has been closed" }, writes: [], fallback: "browser pod lost; re-ran on full" } });
  assert.equal(closed?.line, "1 reconnect, which reached the pod but it closed again; browser pod lost; re-ran on full (browser has been closed)");
  const failed = browserPodNote({ browserPod: { reconnects: 3, reconnected: 0, lost: { cause: "lost", detail: "gone" }, writes: ["state/x.csv (Write)"], failure: "browser pod died after the step had written state/x.csv (Write) — not re-run" } });
  assert.equal(failed?.tone, "bad");
  assert.match(failed!.line, /browser pod died after the step had written state\/x\.csv \(Write\)/);
});

test("the tries: slim (lost) then full, each with its cost — only when a try was lost", () => {
  assert.equal(podTries({}), null);
  assert.equal(podTries({ tries: [{ n: 1, status: "completed", costUsd: 0.02, tokens: null, computeSecs: 5, startedAt: "", finishedAt: "", image: "full" }] }), null);
  assert.equal(
    podTries({ tries: [
      { n: 1, status: "lost", costUsd: 0.004, tokens: null, computeSecs: 40, startedAt: "", finishedAt: "", image: "slim", browserPod: "4 reconnects; pod lost: ECONNREFUSED" },
      { n: 2, attempt: 1, status: "completed", costUsd: 0.006, tokens: null, computeSecs: 50, startedAt: "", finishedAt: "", image: "full" },
    ] }),
    "#1 slim · lost · $0.0040 → #2 full · completed · $0.0060",
  );
});

test("the tries show even when the last attempt left no pod note — slim (lost), full (failed), then a retry", () => {
  const tries: NonNullable<Parameters<typeof browserPodPanel>[0]["tries"]> = [
    { n: 1, status: "lost", costUsd: 0.004, tokens: null, computeSecs: 40, startedAt: "", finishedAt: "", image: "slim" },
    { n: 2, attempt: 1, status: "failed", costUsd: 0.006, tokens: null, computeSecs: 50, startedAt: "", finishedAt: "", image: "full" },
    { n: 3, attempt: 2, status: "completed", costUsd: 0.005, tokens: null, computeSecs: 45, startedAt: "", finishedAt: "", image: "full" },
  ];
  // Core sets browserPod per attempt: the retry on full had no pod, so it is null.
  const panel = browserPodPanel({ browserPod: null, tries });
  assert.ok(panel, "the box shows");
  assert.equal(panel!.line, null);
  assert.equal(panel!.tries, "#1 slim · lost · $0.0040 → #2 full · failed · $0.0060 → #3 full · completed · $0.0050");
  assert.equal(browserPodPanel({ browserPod: null, tries: [tries[2]] }), null, "no lost try, no note: nothing");
});

test("the credential chip: which one the model was called with, the variable in the tooltip", () => {
  assert.deepEqual(stepCredential({ credential: "API key (ANTHROPIC_API_KEY)" }), { label: "API key", title: "model credential: API key (ANTHROPIC_API_KEY)" });
  assert.equal(stepCredential({ credential: "Claude login token (CLAUDE_CODE_OAUTH_TOKEN)" })?.label, "Claude login");
  assert.equal(stepCredential({ credential: "bearer token (ANTHROPIC_AUTH_TOKEN) to https://gw" })?.label, "gateway token");
  assert.equal(stepCredential({ credential: "provider: openrouter https://openrouter.ai/api" })?.label, "own provider");
  assert.equal(stepCredential({ credential: "none set" })?.label, "no credential");
  assert.equal(stepCredential({}), null, "a record from before the field");
});

test("the start-up chip runs to the model's first word and gives each phase its own share", () => {
  const up = stepStartup({ startup: { services: 0.4, applied: 0.52, ready: 1.38, files: 2.9, go: 3.38, driver: 3.9, tools: 4.6, model: 7.45 } });
  assert.equal(up?.label, "start-up 7.5s");
  assert.equal(
    up?.title,
    "until the model's first word: services +0.40s · applied +0.12s · ready +0.86s · files +1.52s · go +0.48s · driver +0.52s · tools +0.70s · model +2.85s",
  );
  // a step that never reached the model says so, and ends at its last mark
  assert.match(stepStartup({ startup: { ready: 1, go: 3 } })!.title, /^start-up so far: /);
  assert.equal(stepStartup({ startup: { ready: 1, go: 3 } })!.label, "start-up 3.0s");
  // steps from before the marks, and in-process ones, show nothing
  assert.equal(stepStartup({}), null);
  assert.equal(stepStartup({ startup: null }), null);
});

test("what a step held reads as numbers, with the class and the agent's resources: behind it", () => {
  assert.equal(stepHeld({}), null, "a record from before sizes");
  const plain = stepHeld({ size: "large", reserved: { cpus: 3, memGiB: 6 } })!;
  assert.equal(plain.label, "3 vCPU · 6 GiB");
  assert.equal(plain.title, "held 3 vCPU · 6 GiB — size: large");
  const own = stepHeld({
    size: "large",
    reserved: { cpus: 1, memGiB: 1.5 },
    resources: { cpu: 1, memory: "1536Mi" },
    actual: { busyCpuSecs: 40, peakMemBytes: null, rxBytes: null, txBytes: null, throttledSecs: 12.25 },
  })!;
  assert.equal(own.label, "1 vCPU · 1.5 GiB");
  assert.match(own.title, /resources: cpu: 1, memory: 1536Mi/);
  assert.match(own.title, /the CPU cap held it back 12\.3s/);
});

test("the editor's resources: chip", () => {
  assert.equal(resourcesLabel({ cpu: 1, memory: "3Gi", disk: "12Gi" }), "1 cpu · 3Gi · 12Gi disk");
  assert.equal(resourcesLabel({ memory: "4Gi" }), "4Gi");
  assert.equal(resourcesLabel({}), null);
  assert.equal(resourcesLabel("big"), null);
});

test("refused paths: named on the run page, quiet when there were none (FOL-96)", () => {
  assert.equal(stepRefused({}), null);
  assert.equal(stepRefused({ refused: [] }), null);
  const one = stepRefused({ refused: [{ path: "AGENTS.md", kind: "config" }] });
  assert.deepEqual(one?.paths, ["AGENTS.md"]);
  assert.match(one!.line, /changed the workspace's configuration; that change was not kept/);
  const both = stepRefused({ refused: [{ path: "flows/x.md", kind: "config" }, { path: "scripts/r.py", kind: "code" }] });
  assert.match(both!.line, /configuration and code; those changes were not kept/);
  assert.deepEqual(both?.paths, ["flows/x.md", "scripts/r.py"]);
});
