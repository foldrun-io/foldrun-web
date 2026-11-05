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

import { opsLog } from "@/lib/ops-log.ts";
import fs from "node:fs";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { workspaceDir } from "@/lib/store";
import { WORKSPACE_PATCHABLE } from "@/components/defaults-model";
import { can } from "@/platform/permissions.ts";
import { refuseInternalUrl } from "@/platform/ssrf";
import { guardsUntrustedUrls } from "@/lib/platform";
import { schemaKindOf } from "@/lib/frontmatter-fields";
import { readRemotes } from "@/lib/a2a-remotes";
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
  assertRemoteCardsAllowed(tenant, workspace, files);
  if (can(actor.role, "workspace:manage")) return;
  // A flow's `a2a:` — whether outside agents may call it — is the
  // workspace's policy too (1 Nov 2026): publishing a flow opens it to every
  // A2A key that names it, an admin's decision, by every door into the file.
  const published = changedFlowPublications(tenant, workspace, files, mode);
  if (published.length) {
    throw new ApiError(
      `this would change a2a: in ${published.join(", ")} — whether outside agents may call ${published.length === 1 ? "that flow" : "those flows"} over A2A is the workspace's policy, ` +
        `and changing it needs the admin role (workspace:manage); your role is ${actor.role}. Leave a2a: as it is and the rest of the change goes through, or ask an admin to make it.`,
      403,
    );
  }
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

/** A flow file, workspace-relative: flows/<name>.md, the one place a flow
 *  is read from (core schemaKindOf). */
const FLOW_FILE = /^flows\/[^/]+\.md$/;

/** A flow's `a2a:` as the runtime would read it: absent, or a file that
 *  does not parse, publishes nothing. */
function a2aOf(text: string | null): unknown {
  return keysOf(text).a2a;
}

/**
 * The flow files whose `a2a:` a write would change. A flow file the write
 * removes is not one: removing the flow unpublishes it — less open, never
 * more — which an editor may do, as DELETE /source lets them. Every other
 * change counts, publishing and unpublishing alike, as a policy key's does.
 */
export function changedFlowPublications(
  tenant: string,
  workspace: string,
  files: { path: string; content: string }[],
  _mode: "replace" | "merge",
): string[] {
  const dir = workspaceDir(tenant, workspace);
  const out: string[] = [];
  for (const [rel, content] of shippedMap(files)) {
    if (!FLOW_FILE.test(rel)) continue;
    let before: string | null = null;
    try {
      before = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {
      before = null;
    }
    if (stable(a2aOf(before)) !== stable(a2aOf(content))) out.push(rel);
  }
  return out.sort();
}

/**
 * Refuse (400) a write that adds or changes a `remotes:` card at a private,
 * loopback or cluster address on an install that guards untrusted URLs — the
 * same early refusal Settings → Model gives a provider's base URL. Whoever
 * writes it: no role makes such a card callable. A card the file already had
 * is left to the run, which refuses it too (platform checkUntrustedUrl), so a
 * workspace saved before this check still deploys.
 */
export function assertRemoteCardsAllowed(tenant: string, workspace: string, files: { path: string; content: string }[]): void {
  if (!guardsUntrustedUrls()) return;
  const dir = workspaceDir(tenant, workspace);
  const refused: string[] = [];
  for (const [rel, content] of shippedMap(files)) {
    if (schemaKindOf(rel) !== "agent") continue;
    let before: string | null = null;
    try {
      before = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {
      before = null;
    }
    const had = new Set(readRemotes(keysOf(before).remotes).remotes.map((r) => r.card));
    for (const r of readRemotes(keysOf(content).remotes).remotes) {
      if (had.has(r.card)) continue;
      const why = refuseInternalUrl(r.card);
      if (why) refused.push(`${rel}: ${r.name} — ${why}`);
    }
  }
  if (!refused.length) return;
  opsLog("warn", "a2a.remotes_refused", { tenant, workspace, count: refused.length });
  throw new ApiError(
    `this platform does not call private or internal addresses — remotes: ${refused.join("; ")}. Point card: at the remote agent's public https address`,
    400,
  );
}
