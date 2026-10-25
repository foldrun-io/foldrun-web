// Hooks as the dashboard and the API see them: which ones a workspace can
// turn on, where each lives, who turned it on, and whether the web tier may
// run one for a Test.
//
// A hook (core hooks.ts) is a folder — hooks/<name>/hook.md beside run.mjs —
// in the workspace or in the account library. The workspace's own shadows
// the library's by name, the same nearest-wins rule resolveHooks uses in a
// run, so what is listed here is what a step would actually run.

import fs from "node:fs";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { listHookDirs, readHookDef, hookNames, type HookDef } from "@/lib/hooks";
import { workspaceDir, accountDir, listAgents } from "@/lib/store";
import { libraryDir } from "@/lib/library";
import { readAgentsMdKeys } from "@/lib/agents-md";

export interface HookEntry {
  name: string;
  scope: HookDef["scope"];
  /** Workspace-relative for a workspace hook, library-relative for an account one. */
  path: string;
  on?: HookDef["on"];
  tool?: string;
  timeoutSec?: number;
  description?: string;
  /** Why hook.md is not a hook — set instead of on/tool/timeout. */
  error?: string;
  /** Hidden by a workspace hook of the same name. */
  shadowed?: boolean;
  /** Who turns it on: "account" and "workspace" mean every agent under
   *  that AGENTS.md; anything else is an agent's own `hooks:`. */
  onFor: string[];
}

/** Every hook a step in this workspace could name, the workspace's first. */
export function listWorkspaceHooks(tenant: string, workspace: string): HookEntry[] {
  const wsRoot = workspaceDir(tenant, workspace);
  const libRoot = libraryDir(tenant);
  const onFor = turnedOn(tenant, workspace);
  const entries: HookEntry[] = [];
  const own = new Set<string>();
  for (const [root, scope] of [[wsRoot, "workspace"], [libRoot, "account"]] as const) {
    for (const dir of listHookDirs(path.join(root, "hooks"))) {
      const name = path.basename(dir);
      const def = readHookDef(dir, scope);
      const base = { name, scope, path: `hooks/${name}`, onFor: onFor.get(name) ?? [] };
      if (scope === "workspace") own.add(name);
      const shadowed = scope === "account" && own.has(name) ? { shadowed: true } : {};
      if ("error" in def) {
        entries.push({ ...base, error: def.error, ...shadowed });
      } else {
        entries.push({
          ...base,
          on: def.on,
          ...(def.tool ? { tool: def.tool } : {}),
          timeoutSec: def.timeoutSec,
          ...(def.description ? { description: def.description } : {}),
          ...shadowed,
        });
      }
    }
  }
  return entries;
}

/** hook name → who turns it on, from the three `hooks:` a run reads. */
function turnedOn(tenant: string, workspace: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (names: string[], who: string) => {
    for (const n of names) out.set(n, [...(out.get(n) ?? []), who]);
  };
  try {
    add(hookNames(readAgentsMdKeys(accountDir(tenant)).hooks), "account");
  } catch {
    // A flat laptop workspace has no account folder of its own.
  }
  const wsRoot = workspaceDir(tenant, workspace);
  add(hookNames(readAgentsMdKeys(wsRoot).hooks), "workspace");
  for (const a of listAgents(tenant, workspace)) {
    const file = path.join(wsRoot, "agents", a.name, "agent.md");
    if (!fs.existsSync(file)) continue;
    try {
      add(hookNames((configMatter(fs.readFileSync(file, "utf8")).data ?? {}).hooks), a.name);
    } catch {
      // A frontmatter that does not parse is `foldrun check`'s to report.
    }
  }
  return out;
}

export interface HookTestRefusal {
  ok: false;
  testable: false;
  summary: string;
  detail: string;
}

/**
 * Whether this process may run a hook for the Test button. A hook is the
 * customer's own code; on an install that isolates runs
 * (FOLDRUN_RUN_ISOLATION=container | k8s) it only ever runs inside a step's
 * sandbox, and the web tier is not one — so it is sent there instead of
 * spawned beside the platform's own credentials. A laptop (`foldrun dev`)
 * runs every step in-process anyway, so testing here is no wider than a run.
 */
export function hookTestRefusal(env: Record<string, string | undefined> = process.env): HookTestRefusal | null {
  if (!env.FOLDRUN_RUN_ISOLATION) return null;
  return {
    ok: false,
    testable: false,
    summary: "hooks are tested inside a run's sandbox, not from here",
    detail:
      "A hook is your own code, and on this install your code only runs inside a step's sandbox.\n\n" +
      "Test it locally with\n  foldrun hook test <name> --event '{…}'\n" +
      "or with a test run of a flow whose agent has it under hooks:, e.g.\n" +
      "  foldrun invoke <flow> --to <workspace> --test --wait",
  };
}

/** A sample event per kind, for a Test sent with no event — the CLI's own
 *  samples (`foldrun hook test` with no --event), so both test the same. */
export const HOOK_SAMPLE: Record<HookDef["on"], Record<string, unknown>> = {
  "tool.call": { tool: { name: "Bash", input: { command: "ls" } } },
  "tool.result": { tool: { name: "Bash", input: { command: "ls" }, result: "agent.md\n" } },
  "step.start": { prompt: "Find three sources." },
  "step.end": { reply: "Done." },
};

/** The whole event a Test hands the hook: the fields every step's event
 *  carries, with no run behind them, under what the caller sent. */
export function testEvent(def: Pick<HookDef, "name" | "on">, workspace: string, sent: Record<string, unknown> | undefined): Record<string, unknown> {
  const given = sent && Object.keys(sent).length ? sent : HOOK_SAMPLE[def.on];
  return { event: def.on, hook: def.name, run_id: null, step: null, agent: null, workspace, ...given };
}
