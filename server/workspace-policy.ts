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
import { accountDir, workspaceDir } from "@/lib/store";
import { libraryDir } from "@/lib/library";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { secretSites } from "@/lib/secrets";
import { a2aTree, a2aWriteEffect, flowSecretCode, secretCodeSentence, type A2aTree, type TreeFile } from "@/lib/a2a-reach";
import { audit, type AuditAction } from "./audit.ts";
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

/** Is `rel` the path `removed` names, or inside it (a folder removed)? */
function isUnder(rel: string, removed: string): boolean {
  const g = path.normalize(removed).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return g === "." || g === "" || rel === g || rel.startsWith(`${g}/`);
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
  removed: string[] = [],
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
  // A path a delete or a rename removes is gone in a merge, as a deploy's
  // missing file is in a replace (5 Nov 2026: DELETE /source had no check).
  const gone = (rel: string) => removed.some((r) => isUnder(rel, r));
  const after = mode === "replace" ? pick((rel) => shipped.get(rel)) : pick((rel) => shipped.get(rel) ?? (gone(rel) ? null : onDisk(rel)));
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
  opts: { removed?: string[] } = {},
): PolicyEvent[] {
  assertRemoteCardsAllowed(tenant, workspace, files);
  const admin = can(actor.role, "workspace:manage");
  // A flow's `a2a:` — whether outside agents may call it — is the
  // workspace's policy too (1 Nov 2026): publishing a flow opens it to every
  // A2A key that names it, an admin's decision, by every door into the file.
  if (!admin) {
    const published = changedFlowPublications(tenant, workspace, files, mode);
    if (published.length) {
      throw new ApiError(
        `this would change a2a: in ${published.join(", ")} — whether outside agents may call ${published.length === 1 ? "that flow" : "those flows"} over A2A is the workspace's policy, ` +
          `and changing it needs the admin role (workspace:manage); your role is ${actor.role}. Leave a2a: as it is and the rest of the change goes through, or ask an admin to make it.`,
        403,
      );
    }
  }
  // What the agents behind published flows may reach (FOL-112, 5 Nov 2026):
  // an editor may not widen them, and nobody may make a published flow
  // whose agent holds a secret and runs code without an admin's accept_risk.
  const events = assertPublishedFlowsKept(actor, tenant, workspace, files, mode, opts.removed ?? []);
  if (admin) return events;
  const { before, after } = configBeforeAfter(tenant, workspace, files, mode, opts.removed ?? []);
  const changed = changedPolicyKeys(before, after);
  if (!changed.length) return events;
  const list = changed.map((k) => `${k}:`).join(", ");
  throw new ApiError(
    `this would change ${list} in ${workspace}'s AGENTS.md, and ${changed.length === 1 ? "that is" : "those are"} the workspace's policy — ` +
      `changing ${changed.length === 1 ? "it" : "them"} needs the admin role (workspace:manage), and your role is ${actor.role}. ` +
      `Leave ${changed.length === 1 ? "that key" : "those keys"} as ${changed.length === 1 ? "it is" : "they are"} and the rest of the change goes through, or ask an admin to make it.`,
    403,
  );
}

// ── flows published over A2A: what their agents may reach (FOL-112) ────────

/** Something an admin's write did that the audit log records: an agent of a
 *  published flow widened, a risk accepted. The caller writes them once its
 *  write has gone through (auditPolicyEvents). */
export interface PolicyEvent {
  action: Extract<AuditAction, "a2a.agent_widened" | "a2a.risk_accepted">;
  subject: string;
  detail: Record<string, unknown>;
}

/** A refusal a program can branch on: `code` rides the answer beside the
 *  sentence (api.ts refusalFields). */
function refusal(message: string, status: number, code: string): ApiError {
  return Object.assign(new ApiError(message, status), { code });
}

/** The files A2A reads of a workspace: its config, flows, agents (both
 *  layouts) and tools. Everything else is prose to this check. */
export function isA2aRelevant(rel: string): boolean {
  return (
    rel === "AGENTS.md" ||
    rel === "project.md" ||
    /^flows\/[^/]+\.md$/.test(rel) ||
    /^agents\/[^/]+\/agent\.md$/.test(rel) ||
    /^\.(?:claude|agents)\/agents\/[^/]+\.md$/.test(rel) ||
    /^tools\/(?:[^/]+\/tool|[^/]+)\.md$/.test(rel)
  );
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * The secrets of `names` that reach a sandbox: one bound to sites in the
 * vault (`foldrun secrets sites`) never does — the egress proxy fills it for
 * those sites alone — so it is no secret the answer can carry. Read from
 * the vault at each check: core's pure tree cannot see binding and counts
 * every secret, and an unbinding later goes through no write door, which
 * is why the serve path asks again before every task it starts.
 */
export function sandboxSecrets(tenant: string, workspace: string, names: string[]): string[] {
  let bound: Record<string, string[]> = {};
  try {
    bound = secretSites(tenant, names, workspace);
  } catch {
    bound = {}; // a vault that cannot be read binds nothing: count them all
  }
  return names.filter((n) => !bound[n]?.length);
}

/** The A2A-relevant files under `dir`, workspace-relative. Bounded: a
 *  folder, not a recursive walk. */
function relevantOnDisk(dir: string, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  const add = (rel: string) => {
    const t = readText(path.join(dir, rel));
    if (t !== null) out.set(prefix + rel, t);
  };
  const names = (sub: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(path.join(dir, sub), { withFileTypes: true });
    } catch {
      return [];
    }
  };
  if (!prefix) {
    add("AGENTS.md");
    add("project.md");
    for (const e of names("flows")) if (e.isFile() && e.name.endsWith(".md")) add(`flows/${e.name}`);
    for (const e of names("agents")) if (e.isDirectory()) add(`agents/${e.name}/agent.md`);
    for (const sub of [".claude/agents", ".agents/agents"]) for (const e of names(sub)) if (e.isFile() && e.name.endsWith(".md")) add(`${sub}/${e.name}`);
  }
  for (const e of names("tools")) {
    if (e.isFile() && e.name.endsWith(".md")) add(`tools/${e.name}`);
    else if (e.isDirectory()) add(`tools/${e.name}/tool.md`);
  }
  return out;
}

/** A workspace's A2A facts as they stand, with the account's library tools
 *  and network — what the serve path and the dashboard read. */
export function workspaceA2aTree(tenant: string, workspace: string): A2aTree {
  return a2aTree(a2aTreeFiles(tenant, relevantOnDisk(workspaceDir(tenant, workspace))), { accountNetwork: readAgentsMdKeys(accountDir(tenant)).network });
}

function a2aTreeFiles(tenant: string, ws: Map<string, string>): TreeFile[] {
  let lib = new Map<string, string>();
  try {
    lib = relevantOnDisk(libraryDir(tenant), "library/");
  } catch {
    // no library: nothing shared
  }
  return [...lib, ...ws].map(([p, content]) => ({ path: p, content }));
}

/**
 * The published-flow half of the policy check. Before and after are the
 * whole workspace as A2A reads it — so a change elsewhere (AGENTS.md's
 * network: or hooks:, a tool's secrets:, a Claude Code agent file that
 * becomes the one in use) counts as much as one to the agent's own file.
 *
 *   403 a2a_widening      a caller who is not an admin widens an agent of a
 *                         flow that was published (more tools, secrets,
 *                         network, a new agent behind it…);
 *   400 a2a_secret_code   anyone makes a published flow whose agent holds a
 *                         secret and runs code, with no accept_risk for it;
 *   400 a2a_accept_risk   accept_risk gains a name no agent of the flow has.
 *
 * An admin's widening and every new accept_risk come back as audit events.
 */
export function assertPublishedFlowsKept(
  actor: Pick<Actor, "role">,
  tenant: string,
  workspace: string,
  files: { path: string; content: string }[],
  mode: "replace" | "merge",
  removed: string[] = [],
): PolicyEvent[] {
  const shipped = shippedMap(files);
  // Nothing A2A reads is touched, and nothing is removed: the common save
  // (knowledge, a skill, prose) costs no reading.
  if (mode === "merge" && !removed.length && ![...shipped.keys()].some(isA2aRelevant)) return [];
  const dir = workspaceDir(tenant, workspace);
  const disk = relevantOnDisk(dir);
  const isGone = (rel: string) => removed.some((r) => isUnder(rel, r));
  const next = new Map<string, string>();
  if (mode === "merge") for (const [rel, text] of disk) if (!isGone(rel)) next.set(rel, text);
  for (const [rel, text] of shipped) if (isA2aRelevant(rel)) next.set(rel, text);
  const accountNetwork = readAgentsMdKeys(accountDir(tenant)).network;
  const effect = a2aWriteEffect(a2aTree(a2aTreeFiles(tenant, disk), { accountNetwork }), a2aTree(a2aTreeFiles(tenant, next), { accountNetwork }));

  if (effect.widened.length && !can(actor.role, "workspace:manage")) {
    const said = effect.widened.slice(0, 3).map((w) => `${w.agent} behind ${w.flow} (${w.what.join("; ")})`);
    opsLog("warn", "a2a.widening_refused", { tenant, workspace, count: effect.widened.length });
    throw refusal(
      `this would widen what ${said.join(", ")}${effect.widened.length > 3 ? `, and ${effect.widened.length - 3} more` : ""} may reach — ` +
        `${effect.widened.length === 1 ? "that flow is" : "those flows are"} published over A2A, and an admin approved what ${effect.widened.length === 1 ? "its agents" : "their agents"} could do when publishing. ` +
        `Widening that needs the admin role (workspace:manage); your role is ${actor.role}. Leave those agents' tools, secrets, network, hooks and steps as they are and the rest of the change goes through, or ask an admin to make it.`,
      403,
      "a2a_widening",
    );
  }
  if (effect.stale.length) {
    const s = effect.stale[0]!;
    throw refusal(
      `a2a: accept_risk in ${s.flow} names ${s.agents.join(", ")}, which no step of ${s.flow} runs — an acceptance names an agent of the flow, so it never waits to cover whatever is given that name next. Take ${s.agents.length === 1 ? "it" : "them"} out`,
      400,
      "a2a_accept_risk",
    );
  }
  effect.unaccepted = effect.unaccepted.map((e) => ({ ...e, secrets: sandboxSecrets(tenant, workspace, e.secrets) })).filter((e) => e.secrets.length);
  if (effect.unaccepted.length) {
    const said = effect.unaccepted.slice(0, 3).map((e) => secretCodeSentence(e.flow, e));
    const first = effect.unaccepted[0]!;
    throw refusal(
      `${said.join("; ")}${effect.unaccepted.length > 3 ? `; and ${effect.unaccepted.length - 3} more` : ""}. ` +
        `Take Bash away from ${first.agent} (disallowedTools: [Bash]) or the secret (or bind it to its sites so it never enters the sandbox), ` +
        `or have an admin accept the risk: a2a: accept_risk: [${first.agent}] in ${first.flow} — \`foldrun a2a publish ${first.flow} --accept-risk ${first.agent}\`, or the flow's Publish over A2A control.`,
      400,
      "a2a_secret_code",
    );
  }
  const events: PolicyEvent[] = [];
  for (const w of effect.widened) events.push({ action: "a2a.agent_widened", subject: `${workspace}/${w.flow}`, detail: { workspace, flow: w.flow, agent: w.agent, widened: w.what } });
  for (const a of effect.accepted) events.push({ action: "a2a.risk_accepted", subject: `${workspace}/${a.flow}`, detail: { workspace, flow: a.flow, agent: a.agent, secrets: a.secrets, runsCode: true } });
  return events;
}

/** The secret-and-code exposures of one published flow as it stands — what
 *  the serve path refuses new tasks for until an admin accepts them. */
export function unacceptedExposures(tenant: string, workspace: string, flow: string) {
  return flowSecretCode(workspaceA2aTree(tenant, workspace), flow)
    .filter((e) => !e.accepted)
    .map((e) => ({ ...e, secrets: sandboxSecrets(tenant, workspace, e.secrets) }))
    .filter((e) => e.secrets.length);
}

/** Write what an admin's write did to the audit log — after the write, so
 *  the log never says something happened that did not. Best-effort like
 *  every audit() line: the durable record is the flow and agent files'
 *  own revisions (who, when, the diff), which the write itself made. */
export async function auditPolicyEvents(events: PolicyEvent[], by: string, tenant: string): Promise<void> {
  for (const e of events) await audit(e.action, { actor: by, tenant, subject: e.subject, detail: e.detail });
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
