// `inputs` on the run routes (FOL-163): storage paths, as GET …/storage
// lists them, resolved to the bytes each names now — the run holds those
// (platform queue.ts holdBeforeQueued) and its first step finds them at
// agents/<name>/inputs/. One reading of the body for agents/<a>/run and
// flows/<f>/run, so the two cannot drift.

import { ApiError } from "@/server/api";
import { resolveRunInputs, MissingInput, type RunInputFile } from "@/lib/storage";
import { inputsProblem, inputsSizeProblem } from "@/lib/run-inputs";

/** Whether this install stages inputs: a sandbox that copies the step's
 *  files in and takes back only what it should (core runner.ts). */
export function stagesInputs(): boolean {
  const iso = process.env.FOLDRUN_RUN_ISOLATION;
  return iso === "k8s" || iso === "container";
}

/** The resolved inputs, or undefined when none were asked for. Throws an
 *  ApiError a route answers as it is: 400 for the shape or the limits, 404
 *  naming a path with no stored file, 409 where this install cannot stage. */
export function inputsFromBody(tenant: string, workspace: string, raw: unknown): RunInputFile[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const problem = inputsProblem(raw);
  if (problem) throw new ApiError(problem, 400);
  const paths = raw as string[];
  if (!paths.length) return undefined;
  if (!stagesInputs()) throw new ApiError("this install runs steps without the sandbox inputs need (FOLDRUN_RUN_ISOLATION=k8s or container) — nothing was started", 409);
  let files: RunInputFile[];
  try {
    files = resolveRunInputs(tenant, workspace, paths);
  } catch (err) {
    if (err instanceof MissingInput) throw new ApiError(missingText(workspace, err.path), 404);
    throw err;
  }
  const big = inputsSizeProblem(files);
  if (big) throw new ApiError(big, 400);
  return files;
}

/** What a caller is told for a path with no stored file. */
export function missingText(workspace: string, p: string): string {
  return `no stored file ${p} in ${workspace} — inputs are storage paths, as GET …/storage lists them; upload it first (PUT …/storage)`;
}
