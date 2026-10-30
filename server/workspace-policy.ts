// A workspace's policy keys — what its AGENTS.md frontmatter sets for the
// whole workspace: the budget, where to notify, network_enforce, telemetry…
// — are an admin's to change (workspace:manage), on every way into the file.
//
// PATCH /api/workspaces/<ws> always asked for workspace:manage. But an editor
// may write AGENTS.md itself — PUT /source, a deploy, an import, a restore —
// and until 30 Oct 2026 each of those took the same keys with
// workspace:write alone: an editor lifted the budget, turned network_enforce
// off, or pointed notify:/telemetry: (whose ${NAME} placeholders the platform
// fills from the vault) at a host of their own. Every path that writes a
// workspace's AGENTS.md now compares the keys before and after through this
// one check, so the rule is the same whichever door is used. The rest of the
// file — the prose every agent reads, any other key — stays an editor's.
//
// The account's AGENTS.md has one writer, PATCH /api/account, which already
// needs workspace:manage over every workspace (requireAccountWide).

import fs from "node:fs";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { workspaceDir } from "@/lib/store";
import { WORKSPACE_PATCHABLE } from "@/components/defaults-model";
import { can } from "@/platform/permissions.ts";
import { ApiError } from "./api.ts";
import type { Actor } from "./auth.ts";

/** The keys PATCH /api/workspaces/<ws> writes, all behind workspace:manage —
 *  and telemetry:, which the settings form does not write but which sends
 *  every run, with header secrets filled from the vault, to the URL it
 *  names: notify:'s risk and more. A key the job blocks group
 *  (`governance: { budget }`) counts the same: configMatter folds them. */
export const WORKSPACE_POLICY_KEYS: readonly string[] = [...WORKSPACE_PATCHABLE, "telemetry"];

/** The two names the workspace's config is read from, in the runtime's
 *  order (core agents-md.ts readAgentsMdKeys): AGENTS.md, else project.md. */
const CONFIG_FILES = ["AGENTS.md", "project.md"] as const;

/** Frontmatter as the runtime reads it: a file that is missing or does not
 *  parse configures nothing ({}), so a broken file that drops a budget is a
 *  change to the budget. */
function keysOf(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const data = configMatter(text).data;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Same value, whatever order a mapping's keys were written in. */
function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/** Which policy keys differ between two texts of a workspace's AGENTS.md
 *  (null: no file). Added, removed and changed all count. */
export function changedPolicyKeys(before: string | null, after: string | null, keys: readonly string[] = WORKSPACE_POLICY_KEYS): string[] {
  const a = keysOf(before);
  const b = keysOf(after);
  return keys.filter((k) => stable(a[k]) !== stable(b[k]));
}

/** A file list as a deploy writes it: paths normalised, the last of two
 *  entries for one path winning. */
function shippedMap(files: { path: string; content: string }[]): Map<string, string> {
  return new Map(files.map((f) => [path.normalize(f.path).replaceAll("\\", "/"), f.content]));
}

/**
 * The workspace's config text now and after a write.
 *
 *   replace  the files ARE the new tree (a deploy, a restore): an AGENTS.md
 *            they do not carry is removed.
 *   merge    the files are written over the tree (a save, an import): one
 *            they do not carry stays as it is.
 */
export function configBeforeAfter(
  tenant: string,
  workspace: string,
  files: { path: string; content: string }[],
  mode: "replace" | "merge",
): { before: string | null; after: string | null } {
  const dir = workspaceDir(tenant, workspace);
  const onDisk = (rel: string): string | null => {
    try {
      return fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {
      return null;
    }
  };
  const shipped = shippedMap(files);
  const pick = (get: (rel: string) => string | null | undefined): string | null => {
    for (const name of CONFIG_FILES) {
      const text = get(name);
      if (typeof text === "string") return text;
    }
    return null;
  };
  const before = pick(onDisk);
  const after = mode === "replace" ? pick((rel) => shipped.get(rel)) : pick((rel) => shipped.get(rel) ?? onDisk(rel));
  return { before, after };
}

/**
 * Refuse (403) a write that would change a policy key of the workspace's
 * AGENTS.md when the caller may not manage the workspace. The sentence names
 * each key, so the editor knows what to leave alone or whom to ask.
 */
export function assertMayChangeWorkspacePolicy(
  actor: Pick<Actor, "role">,
  tenant: string,
  workspace: string,
  files: { path: string; content: string }[],
  mode: "replace" | "merge",
): void {
  if (can(actor.role, "workspace:manage")) return;
  const { before, after } = configBeforeAfter(tenant, workspace, files, mode);
  const changed = changedPolicyKeys(before, after);
  if (!changed.length) return;
  const list = changed.map((k) => `${k}:`).join(", ");
  throw new ApiError(
    `this would change ${list} in ${workspace}'s AGENTS.md, and ${changed.length === 1 ? "that is" : "those are"} the workspace's policy — ` +
      `changing ${changed.length === 1 ? "it" : "them"} needs the admin role (workspace:manage), and your role is ${actor.role}. ` +
      `Leave ${changed.length === 1 ? "that key" : "those keys"} as ${changed.length === 1 ? "it is" : "they are"} and the rest of the change goes through, or ask an admin to make it.`,
    403,
  );
}
