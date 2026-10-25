// Restore a workspace's source to a point in its history.
//
// Every change to a workspace is a revision holding a snapshot of the whole
// tree (core history.ts), so a "restore" of the markdown is not a backup
// restore at all: it deploys an older revision's snapshot as a NEW revision,
// reached by a time as well as an id, with a dry run first — the platform's
// own deploy history, the way Vercel and Cloudflare roll back, with no git.
//
// What it changes is exactly what a deploy changes: agents, flows,
// knowledge, skills, tools, scripts. What a deploy keeps, it keeps —
// storage/, state/, runs, secrets, and memory an agent wrote that the old
// tree does not mention (core's keptOnDeploy, the same predicate). So this
// never loses a run or an output, and the restore is itself undoable: it is
// one more revision.

import fs from "node:fs";
import path from "node:path";
import { deployWorkspace, planDeploy, type DeployIssue } from "@/lib/deploy";
import { diffLines, headRevision, resolveRevision, snapshotAt, type DiffOp } from "@/lib/history";
import { workspaceDir } from "@/lib/store";
import { ApiError } from "./api.ts";

export interface RestoreFile {
  path: string;
  change: "added" | "updated" | "removed";
  diff: DiffOp[];
}

export interface RestorePlan {
  workspace: string;
  /** The revision restored to. `sha` is its id — the name it had when every
   *  revision was a git commit, kept so older callers read the same field. */
  to: { id: string; sha: string; at: string; by: string; message: string };
  /** The revision before the restore — what "undo" would go back to. */
  from: string | null;
  added: string[];
  updated: string[];
  removed: string[];
  files: RestoreFile[];
  /** Runs in flight: a restore waits for them, as a deploy does. */
  blockedBy: string[];
  /** Nothing would change: the workspace already matches that point. */
  noop: boolean;
  /** The deploy checks on that tree: a restore with any of these is refused. */
  issues: DeployIssue[];
  /** Advisory: the restore goes ahead with these. */
  warnings: DeployIssue[];
}

function readCurrent(tenant: string, workspace: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(workspaceDir(tenant, workspace), rel), "utf8");
  } catch {
    return "";
  }
}

function target(tenant: string, workspace: string, to: string) {
  if (!fs.existsSync(workspaceDir(tenant, workspace))) throw new ApiError(`no workspace "${workspace}"`, 404);
  if (!headRevision(tenant, workspace)) throw new ApiError("this workspace has no history to restore from yet", 409);
  const point = resolveRevision(tenant, workspace, to);
  if (!point) throw new ApiError(`nothing in ${workspace}'s history at or before "${to}"`, 404);
  return { ...point, sha: point.id };
}

function treeOf(tenant: string, workspace: string, id: string) {
  const files = snapshotAt(tenant, workspace, id);
  if (!files) throw new ApiError(`revision ${id} holds no snapshot to restore`, 409);
  return files;
}

/** What restoring to `to` would change, with a diff per file. Writes nothing. */
export function planRestore(tenant: string, workspace: string, to: string, opts: { diffs?: boolean } = {}): RestorePlan {
  const point = target(tenant, workspace, to);
  const files = treeOf(tenant, workspace, point.id);
  // History holds source; what an agent wrote into its own folder at run
  // time (a browser profile, a PDF it downloaded) was never in a snapshot,
  // so a restore leaves it where it is rather than deleting it.
  const plan = planDeploy(tenant, workspace, files, { keepUntracked: true });
  const want = new Map(files.map((f) => [f.path, f.content]));
  const withDiff = (rel: string, change: RestoreFile["change"]): RestoreFile => ({
    path: rel,
    change,
    diff: opts.diffs === false ? [] : diffLines(change === "added" ? "" : readCurrent(tenant, workspace, rel), change === "removed" ? "" : (want.get(rel) ?? "")),
  });
  return {
    workspace,
    to: point,
    from: headRevision(tenant, workspace)?.id ?? null,
    added: plan.added,
    updated: plan.updated,
    removed: plan.removed,
    files: [
      ...plan.updated.map((p) => withDiff(p, "updated")),
      ...plan.added.map((p) => withDiff(p, "added")),
      ...plan.removed.map((p) => withDiff(p, "removed")),
    ],
    blockedBy: plan.blockedBy,
    noop: plan.added.length + plan.updated.length + plan.removed.length === 0,
    issues: plan.issues,
    warnings: plan.warnings,
  };
}

/**
 * Do it. `expectRemoved`, when given, is the removal list the person saw in
 * the dry run: anything else that would now be removed refuses the restore
 * (core's own check, in the same call that writes).
 */
export function applyRestore(
  tenant: string,
  workspace: string,
  to: string,
  opts: { by: string; expectRemoved?: string[] },
): { applied: boolean; plan: RestorePlan; main: string | null; unexpectedRemovals?: string[]; issues?: unknown[] } {
  const plan = planRestore(tenant, workspace, to, { diffs: false });
  if (plan.noop) return { applied: false, plan, main: plan.from };
  const result = deployWorkspace(tenant, workspace, treeOf(tenant, workspace, plan.to.id), {
    commit: null,
    force: false,
    by: opts.by,
    message: `restored to ${plan.to.id} (${plan.to.at})`,
    keepUntracked: true,
    expectRemoved: opts.expectRemoved,
  });
  return {
    applied: result.applied,
    plan: { ...plan, blockedBy: result.blockedBy },
    main: headRevision(tenant, workspace)?.id ?? null,
    ...(result.unexpectedRemovals ? { unexpectedRemovals: result.unexpectedRemovals } : {}),
    ...(result.issues?.length ? { issues: result.issues } : {}),
  };
}
