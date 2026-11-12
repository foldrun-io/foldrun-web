// Files to text, as the three routes answer it (12 Nov 2026):
//
//   POST /api/extract                                 a file sent whole
//   GET  /api/extract/<id>                            a job, polled
//   POST /api/workspaces/<ws>/storage/extract         a stored file, its text written beside it
//
// The work is the platform's (platform extract.ts): the parser pod, Whisper,
// artifacts, jobs, limits. A route waits up to `wait` seconds (0–60, default
// 50) for the job: done is 200 with the text, still running is 202 with where
// to poll, failed is the job's own refusal with its status and code.

import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "./api.ts";
import { scopeAllows } from "@/platform/scope.ts";
import { ExtractError, type ExtractJob } from "@/platform/extract.ts";
import type { Actor } from "./auth.ts";

export const DEFAULT_WAIT_S = 50;
export const MAX_WAIT_S = 60;

/** `wait`, as seconds: a number 0–60, default 50; anything else is a 400. */
export function waitSeconds(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_WAIT_S;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_WAIT_S) throw new ApiError(`wait is seconds, 0 to ${MAX_WAIT_S}`, 400);
  return n;
}

/** The credential a job is started by: the rate limit's key, and who may read it. */
export const credentialOf = (actor: Actor) => `${actor.kind}:${actor.id}`;

/** May this caller read this job? Any member of the account, except that a
 *  member or key held to some workspaces reads only jobs of those — and the
 *  account-level jobs it started itself. */
export function mayRead(actor: Actor, job: ExtractJob): boolean {
  if (actor.workspaces === null) return true;
  if (job.workspace) return scopeAllows(actor.workspaces, job.workspace);
  return job.actor === credentialOf(actor);
}

/** A job's public view (GET /api/extract/<id>). */
export function jobView(job: ExtractJob) {
  return {
    id: job.id,
    status: job.status,
    ...(job.workspace ? { workspace: job.workspace } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.writePath ? { wrote: job.wrote } : {}),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

/** What a POST answers once it has waited: the text, the job to poll, or the refusal. */
export function answerFor(job: ExtractJob | null, extra: (job: ExtractJob) => Record<string, unknown> = () => ({})) {
  if (!job) return errorResponse(new ApiError("the extraction was lost — ask again", 500));
  if (job.status === "running") {
    // Retry-After: when polling is worth it again.
    return NextResponse.json({ id: job.id, status: "running", poll: `/api/extract/${job.id}` }, { status: 202, headers: { "retry-after": "3" } });
  }
  if (job.status === "failed" || !job.result) {
    const e = job.error ?? { status: 500, code: "internal", message: "the extraction failed on our side" };
    return errorResponse(new ExtractError(e.status, e.code, e.message, e.status === 429 || e.status === 503 ? 15 : undefined));
  }
  return NextResponse.json({ ...job.result, ...extra(job) });
}
