// Which runner image a step ran on, and what happened to the account's
// browser pod under it — the run page's step header and its one-line note.
//
// A browsing step may run on the slim image and browse through the pod
// (foldrun-core browser-pod.ts). When the pod goes, the step either ran
// again on the full image (it had only read) or failed naming what it had
// written. Both must be readable on the run page without opening the trace.
// Pure, so tests/step-image.test.ts pins the wording.

import type { StepRecord } from "@/lib/store";
import { browserPodLine, podTriesLine } from "@/lib/browser-pod";

export interface StepImageView {
  /** The header chip: "slim · browser pod", "full", "slim". */
  label: string;
  /** Why this image — the chip's tooltip. */
  title: string;
}

export interface BrowserPodView {
  line: string;
  /** ok: reconnects that got through or none; warn: re-ran on full; bad: failed. */
  tone: "ok" | "warn" | "bad";
}

export function stepImage(step: Pick<StepRecord, "image">): StepImageView | null {
  const im = step.image;
  if (!im?.variant) return null;
  const label = im.variant === "slim" && im.pod ? "slim · browser pod" : im.variant;
  const title = im.why
    ? `runner image: ${im.variant} — ${im.why}`
    : im.variant === "slim"
      ? "runner image: slim — no browser in the step"
      : "runner image: full — browsers in the step";
  return { label, title };
}

/** What the step's sandbox held, as numbers: "2 vCPU · 4 GiB" — the bill's
 *  figures (core-seconds, GiB-seconds), not the class name, so nobody has to
 *  remember what `large` means. The tooltip says the class, the agent's
 *  `resources:` when it set any, and how long the CPU cap held the step back. */
export function stepHeld(step: Pick<StepRecord, "reserved" | "size" | "resources" | "actual">): StepImageView | null {
  const r = step.reserved;
  if (!r) return null;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const label = `${n(r.cpus)} vCPU · ${n(r.memGiB)} GiB`;
  const asked = step.resources
    ? Object.entries(step.resources).map(([k, v]) => `${k}: ${v}`).join(", ")
    : null;
  const throttled = step.actual?.throttledSecs;
  const title = [
    `held ${label}${step.size ? ` — size: ${step.size}` : ""}`,
    asked ? `resources: ${asked}` : null,
    typeof throttled === "number" && throttled > 0 ? `the CPU cap held it back ${throttled.toFixed(1)}s` : null,
  ].filter(Boolean).join("\n");
  return { label, title };
}

/** The order a step's start-up happens in — core run-container.ts
 *  #STARTUP_PHASES, repeated here as words because the dashboard imports
 *  only what a page needs. */
const STARTUP_ORDER = ["services", "room", "applied", "ready", "files", "go", "shim", "system", "driver", "imports", "tools", "model"] as const;

/**
 * How long the step took to start, and where it went: the chip says until
 * the model's first word (or the last phase marked), the title gives each
 * phase's own share — what FOL-29's cold-start work reads. Null on a step
 * from before 17 Oct 2026, or an in-process one, which marks nothing.
 */
export function stepStartup(step: Pick<StepRecord, "startup">): StepImageView | null {
  const ph = step.startup;
  if (!ph) return null;
  const seen = STARTUP_ORDER.filter((p) => typeof ph[p] === "number");
  if (!seen.length) return null;
  const end = ph.model ?? Math.max(...seen.map((p) => ph[p]!));
  let prev = 0;
  const parts = seen.map((p) => {
    const at = ph[p]!;
    const took = Math.max(0, at - prev);
    prev = Math.max(prev, at);
    return `${p} +${took.toFixed(2)}s`;
  });
  return {
    label: `start-up ${end.toFixed(1)}s`,
    title: `${ph.model != null ? "until the model's first word" : "start-up so far"}: ${parts.join(" · ")}`,
  };
}

export function browserPodNote(step: Pick<StepRecord, "browserPod">): BrowserPodView | null {
  const p = step.browserPod;
  if (!p) return null;
  // A step that browsed through the pod and never lost it says nothing:
  // the image chip already says where it rendered.
  if (!p.reconnects && !p.lost && !p.fallback && !p.failure) return null;
  return {
    line: browserPodLine(p),
    tone: p.failure ? "bad" : p.fallback || p.lost ? "warn" : "ok",
  };
}

/** The step's tries when the pod was lost under one — the slim go (lost)
 *  and the full re-run, each with its own cost. Null otherwise. */
export function podTries(step: Pick<StepRecord, "tries">): string | null {
  return podTriesLine(step.tries);
}

export interface BrowserPodPanel {
  /** The pod note, or null when the last attempt had nothing to say about
   *  the pod (a retry that ran on full overwrites core's browserPod). */
  line: string | null;
  tone: BrowserPodView["tone"];
  /** The numbered tries, whenever a try was lost — whatever the last
   *  attempt's pod record says. */
  tries: string | null;
}

/** The run page's browser-pod box: the note and the tries, either alone.
 *  slim (lost) → full (failed) → a retry with no pod leaves no note, but
 *  the tries still show the lost go. */
export function browserPodPanel(step: Pick<StepRecord, "browserPod" | "tries">): BrowserPodPanel | null {
  const note = browserPodNote(step);
  const tries = podTries(step);
  if (!note && !tries) return null;
  return { line: note?.line ?? null, tone: note?.tone ?? "warn", tries };
}

/**
 * Which model credential the step ran on (core model-credential.ts) — the
 * chip beside the image: short in the header, the variable in the tooltip.
 * Null on records from before the field existed.
 */
export function stepCredential(step: Pick<StepRecord, "credential">): StepImageView | null {
  const c = step.credential;
  if (!c) return null;
  const label = c.startsWith("API key")
    ? "API key"
    : c.startsWith("Claude login token")
      ? "Claude login"
      : c.startsWith("bearer token")
        ? "gateway token"
        : c.startsWith("provider:")
          ? "own provider"
          : "no credential";
  return { label, title: `model credential: ${c}` };
}

/** What a step changed that was not taken back to the workspace —
 *  configuration and code, which a run proposes and a person applies
 *  (core copy-back.ts, FOL-96). Null when nothing was refused. */
export interface RefusedView {
  line: string;
  paths: string[];
}

export function stepRefused(step: Pick<StepRecord, "refused">): RefusedView | null {
  const r = step.refused;
  if (!r?.length) return null;
  const config = r.filter((x) => x.kind === "config").length;
  const code = r.length - config;
  const what = [config ? "configuration" : null, code ? "code" : null].filter(Boolean).join(" and ");
  return {
    line:
      `This step changed the workspace's ${what}; ${r.length === 1 ? "that change was" : "those changes were"} not kept. ` +
      `A run doesn't change its own setup — propose it as a fix, and a person applies it.`,
    paths: r.map((x) => x.path),
  };
}
