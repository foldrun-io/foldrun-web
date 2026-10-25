// An eval run the caller does not wait on (POST …/evals/<e>/run with
// `async: true`). An eval of slow cases outlives a proxy's patience —
// Cloudflare answers 524 after its read timeout (125 s by default) while the
// eval goes on — so the caller gets a run id at once and polls
// GET …/evals/<e>/run?run=<id>.
//
// Two records, each with one job (settled in a Codex debate, 21 Oct 2026):
//
//   the lease — a notices row (platform notices.ts, kind "eval-run"): who is
//     running this eval now. Claim, beat, release and fail are each one
//     updateNotice — a transaction under an advisory lock with Postgres — so
//     two replicas cannot both take it. Renewed every 30 s; silent for two
//     minutes, it is lost.
//   the outcome — a file per run (.results/runs/<eval>/<id>.json), written
//     whole: what THAT run ended with, its result or its error. A deploy's
//     eval, or the next manual run, writes the shared "latest" result, never
//     this file, so a caller always gets its own run's verdict.
//
// A run id the store does not have (pruned, or never issued) is said as
// unavailable — never as a success.
//
// Two lanes share it: an eval's runs (kind "eval-run", outcomes under
// runs/<eval>/) and its model comparisons (kind "eval-compare", under
// compare/<eval>/, core eval-compare.ts). Each eval has one of each at a
// time; a comparison never writes the eval's latest result.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { workspaceDir, assertSafeName } from "@/lib/store";
import type { EvalResult } from "@/lib/evals";
import type { EvalComparison } from "@/lib/eval-compare";
import { getNotice, updateNotice } from "@/platform/notices";

const BEAT_MS = 30_000;
/** Four missed beats: the lease is lost. */
const STALE_MS = 4 * BEAT_MS;
/** Outcomes kept per eval; older run ids answer "unavailable". */
const KEEP_RUNS = 20;

interface Lease {
  runId: string;
  startedAt: string;
  beat: string;
  /** The run has ended (its outcome file is written); the lease is free. */
  ended?: boolean;
  /** How far it has got, when the work says (a comparison does). */
  progress?: { done: number; total: number };
}

export interface LaneOutcome<R> {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "done" | "failed";
  result?: R;
  error?: string;
}

/** One run's state, as a poll for it answers. */
export type LaneView<R> =
  | { runId: string; state: "running"; startedAt: string; progress?: { done: number; total: number } }
  | { runId: string; state: "done"; startedAt: string; result: R }
  | { runId: string; state: "failed" | "lost" | "unavailable"; startedAt?: string; error: string };

export interface LaneClaim<R> {
  runId: string;
  startedAt: string;
  /** Says how far it has got; best effort, never thrown. */
  progress(done: number, total: number): Promise<void>;
  /** Saves this run's outcome, then frees the lease (if still this run's). */
  finish(outcome: { result: R } | { error: string }): Promise<void>;
}

const scope = (workspace: string, name: string) => `${workspace}/${name}`;
const live = (l: Lease | null | undefined, now: number) => !!l && !l.ended && now - Date.parse(l.beat) < STALE_MS;
const RUN_ID = /^[a-f0-9]{24}$/;

function lane<R>(kind: "eval-run" | "eval-compare", subdir: "runs" | "compare", noun: string) {
  const dirOf = (tenant: string, workspace: string, name: string): string => {
    assertSafeName(name, "eval");
    return path.join(workspaceDir(tenant, workspace), "evals", ".results", subdir, name);
  };

  const readOutcome = (tenant: string, workspace: string, name: string, runId: string): LaneOutcome<R> | null => {
    if (!RUN_ID.test(runId)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dirOf(tenant, workspace, name), `${runId}.json`), "utf8")) as LaneOutcome<R>;
    } catch {
      return null;
    }
  };

  /** Whole or not at all (temp, then rename), and the oldest past KEEP_RUNS pruned. */
  const writeOutcome = (tenant: string, workspace: string, name: string, outcome: LaneOutcome<R>): void => {
    const dir = dirOf(tenant, workspace, name);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${outcome.runId}.json`);
    const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(outcome));
    fs.renameSync(tmp, file);
    try {
      const kept = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const old of kept.slice(KEEP_RUNS)) fs.rmSync(path.join(dir, old.f), { force: true });
    } catch {
      /* pruning is tidiness, not correctness */
    }
  };

  /** One run, by its id: its outcome if it ended, else what its lease says. */
  const outcomeView = (runId: string, o: LaneOutcome<R>): LaneView<R> =>
    o.status === "done" && o.result
      ? { runId, state: "done", startedAt: o.startedAt, result: o.result }
      : { runId, state: "failed", startedAt: o.startedAt, error: o.error ?? "the run failed without saying why" };

  async function read(tenant: string, workspace: string, name: string, runId: string, now = Date.now()): Promise<LaneView<R>> {
    const outcome = readOutcome(tenant, workspace, name, runId);
    if (outcome) return outcomeView(runId, outcome);
    const lease = (await getNotice<Lease>(tenant, kind, scope(workspace, name)))?.payload;
    if (lease?.runId === runId && live(lease, now)) return { runId, state: "running", startedAt: lease.startedAt, ...(lease.progress ? { progress: lease.progress } : {}) };
    // The run may have saved its outcome and freed the lease while the lease
    // was being read: look again before calling it lost or unknown.
    const late = readOutcome(tenant, workspace, name, runId);
    if (late) return outcomeView(runId, late);
    if (lease?.runId === runId && !lease.ended) {
      return { runId, state: "lost", startedAt: lease.startedAt, error: `the ${noun} stopped reporting before it saved a result — it may have been interrupted (a restart or a deploy); start it again` };
    }
    return { runId, state: "unavailable", error: `no ${noun} ${runId} of ${name} on record — it may be older than the last ${KEEP_RUNS}` };
  }

  /** Whoever holds the eval now, if anyone — for the page and a bare GET. */
  async function current(tenant: string, workspace: string, name: string, now = Date.now()): Promise<{ runId: string; startedAt: string; progress?: { done: number; total: number } } | null> {
    const lease = (await getNotice<Lease>(tenant, kind, scope(workspace, name)))?.payload;
    return live(lease, now) ? { runId: lease!.runId, startedAt: lease!.startedAt, ...(lease!.progress ? { progress: lease!.progress } : {}) } : null;
  }

  /** Every kept outcome, newest first. */
  function past(tenant: string, workspace: string, name: string): LaneOutcome<R>[] {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dirOf(tenant, workspace, name)).filter((f) => /^[a-f0-9]{24}\.json$/.test(f));
    } catch {
      return [];
    }
    return files
      .map((f) => readOutcome(tenant, workspace, name, f.slice(0, -5)))
      .filter((o): o is LaneOutcome<R> => !!o)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Claim the eval for one run, or null when a live run holds it. */
  async function claim(tenant: string, workspace: string, name: string, now = Date.now()): Promise<LaneClaim<R> | null> {
    const key = scope(workspace, name);
    const runId = crypto.randomBytes(12).toString("hex");
    const startedAt = new Date(now).toISOString();
    let mine = false;
    await updateNotice<Lease>(tenant, kind, key, (prev) => {
      if (live(prev, now)) return prev!;
      mine = true;
      return { runId, startedAt, beat: startedAt };
    });
    if (!mine) return null;
    // Every lease change after the claim is conditional on still holding it:
    // a superseded owner can never touch its successor's lease.
    const own = (change: (l: Lease) => Lease) =>
      updateNotice<Lease>(tenant, kind, key, (prev) => (prev && prev.runId === runId && !prev.ended ? change(prev) : prev!));
    const timer = setInterval(() => {
      // A beat that cannot be written is logged, never thrown from a timer.
      own((l) => ({ ...l, beat: new Date().toISOString() })).catch((err) =>
        console.error(`[foldrun] ${noun} ${workspace}/${name}: heartbeat not written —`, err instanceof Error ? err.message : err),
      );
    }, BEAT_MS);
    timer.unref?.();
    return {
      runId,
      startedAt,
      async progress(done, total) {
        await own((l) => ({ ...l, beat: new Date().toISOString(), progress: { done, total } })).catch(() => undefined);
      },
      async finish(end) {
        // The outcome first, under this run's own id: whatever happens to the
        // lease after, a poll for this run finds how it ended. Retried; if it
        // never lands the lease is NOT freed — the beat stops, and the run
        // reads as lost, never as a finish without a verdict.
        const outcome: LaneOutcome<R> = {
          runId,
          startedAt,
          finishedAt: new Date().toISOString(),
          ...("result" in end ? { status: "done" as const, result: end.result } : { status: "failed" as const, error: end.error }),
        };
        let saved = false;
        for (const wait of [0, 1000, 3000]) {
          if (wait) await new Promise((r) => setTimeout(r, wait));
          try {
            writeOutcome(tenant, workspace, name, outcome);
            saved = true;
            break;
          } catch (err) {
            console.error(`[foldrun] ${noun} ${workspace}/${name}: outcome of ${runId} not saved yet —`, err instanceof Error ? err.message : err);
          }
        }
        if (!saved) {
          clearInterval(timer);
          return;
        }
        // Then the lease is freed, retried — a database blip must not keep the
        // eval looking busy for two minutes.
        for (const wait of [0, 1000, 3000, 10_000]) {
          if (wait) await new Promise((r) => setTimeout(r, wait));
          try {
            await own((l) => ({ ...l, ended: true }));
            break;
          } catch (err) {
            console.error(`[foldrun] ${noun} ${workspace}/${name}: lease not freed yet —`, err instanceof Error ? err.message : err);
          }
        }
        clearInterval(timer);
      },
    };
  }

  return { read, current, claim, past };
}

// ---------------------------------------------------------------- eval runs

export type EvalRunOutcome = LaneOutcome<EvalResult>;
export type EvalRunView = LaneView<EvalResult>;
export type EvalRunClaim = LaneClaim<EvalResult>;

const runs = lane<EvalResult>("eval-run", "runs", "run");
export const readEvalRun = runs.read;
export const currentEvalRun = runs.current;
export const claimEvalRun = runs.claim;

// ---------------------------------------------------------- model comparisons

export type EvalCompareView = LaneView<EvalComparison>;
export type EvalCompareOutcome = LaneOutcome<EvalComparison>;

const compares = lane<EvalComparison>("eval-compare", "compare", "comparison");
export const readEvalCompare = compares.read;
export const currentEvalCompare = compares.current;
export const claimEvalCompare = compares.claim;
export const pastEvalCompares = compares.past;
