// The platform's check of one deployed workspace — one place, so the Checks
// page (through GET …/check) and the editor cannot disagree about a finding.
//
// The files alone do not say everything a rule needs: which tools act
// outside the workspace (a library tool may be `outward: true`) and the
// account's `network:` level above the workspace's. Both are resolved here,
// the way a run resolves them.

import path from "node:path";
import { workspaceDir } from "@/lib/store";
import { checkFiles, isSourcePath, TreeTooLarge } from "@/lib/deploy";
import { checkOptions, checkTree, checkWorkspace } from "@/lib/workspace-check";
import type { ScanFinding } from "@/lib/scan";

/** One finding about a file being saved, as the save route answers it. */
export interface SaveIssue {
  level: "error" | "warn";
  rule: string;
  where: string;
  message: string;
}

/**
 * FOL-57: the checks a deploy runs, on the workspace as it would be with
 * `content` at `rel`, for that file only. Errors are what a deploy would
 * refuse; a dashboard save used to write them straight into the live
 * workspace, where the next run (or the next deploy) tripped on them.
 * Other files' findings are not this save's business.
 */
export function saveCheck(tenant: string, workspace: string, raw: string, content: string): SaveIssue[] {
  // The spelling the writer stores (`./flows/x.md` is flows/x.md), so the
  // file checked is the file written (Codex review).
  const rel = path.posix.normalize(raw.replaceAll("\\", "/")).replace(/^(\.\/)+/, "");
  if (!isSourcePath(rel)) return [];
  let tree;
  try {
    tree = checkTree(workspaceDir(tenant, workspace)).filter((f) => f.path !== rel);
  } catch (err) {
    // Too much to read to check one save: the save is not refused for it.
    if (err instanceof TreeTooLarge) return [];
    throw err;
  }
  tree.push({ path: rel, content });
  return checkFiles(tree, checkOptions(tenant, workspace))
    .filter((f) => f.file === rel && f.level !== "info")
    .map((f) => ({ level: f.level === "error" ? ("error" as const) : ("warn" as const), rule: f.rule, where: `${f.file}${f.line ? `:${f.line}` : ""}`, message: f.message }));
}

/** The Checks page's, the API's and the daily rescan's one answer (core workspace-check.ts). */
export function workspaceCheck(tenant: string, workspace: string): ScanFinding[] {
  return checkWorkspace(tenant, workspace);
}
