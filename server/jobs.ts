// The four jobs of running agents (core frontmatter-fields.ts JOBS), as a
// workspace or the account has them set: each AGENTS.md field of each job,
// the account's value, the workspace's, how the two combine, and whether
// this scope's settings can write it. No single "effective" value: fields
// combine differently (network_enforce ORs, budgets both apply, limits merge
// per key), and a value that pretended otherwise would be wrong (Codex
// debate, 21 Oct 2026). What `foldrun jobs` prints and what
// `foldrun account set governance.<field>` checks against.

import { JOBS, fieldsOfJob, type Job } from "@/lib/frontmatter-fields";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { accountDir, workspaceDir } from "@/lib/store";
import { ACCOUNT_PATCHABLE, WORKSPACE_PATCHABLE } from "@/components/defaults-model";

/** How an account's and a workspace's value for a field combine at run time. */
export type Combine = "workspace replaces" | "either turns it on" | "both apply" | "per key" | "per field" | "level nearest, sites from both" | "account only";

const COMBINE: Record<string, Combine> = {
  owner: "workspace replaces",
  budget: "both apply",
  priority: "account only",
  concurrency: "account only",
  deploy_block: "workspace replaces",
  limits: "per key",
  // core network.ts resolveNetwork: level and defaults from the nearest
  // setting, the allow lists of every level together.
  network: "level nearest, sites from both",
  network_enforce: "either turns it on",
  hooks: "both apply",
  alerts: "workspace replaces",
  telemetry: "workspace replaces",
  notify: "workspace replaces",
  capture: "workspace replaces",
  judge: "per field",
};

export interface JobField {
  key: string;
  account: unknown;
  /** Present when a workspace was asked about. */
  workspace?: unknown;
  combine: Combine;
  /** This scope's settings (PATCH /api/account, or the workspace's) write it;
   *  otherwise it is written in AGENTS.md itself. */
  writable: boolean;
}

export interface JobView {
  name: Job;
  title: string;
  what: string;
  fields: JobField[];
}

export function jobsView(tenant: string, workspace: string | null): JobView[] {
  const account = readAgentsMdKeys(accountDir(tenant));
  const ws = workspace ? readAgentsMdKeys(workspaceDir(tenant, workspace)) : null;
  const writable = new Set<string>(workspace ? WORKSPACE_PATCHABLE : ACCOUNT_PATCHABLE);
  const set = (v: unknown) => (v === undefined ? null : v);
  return JOBS.map((j) => ({
    name: j.name,
    title: j.title,
    what: j.what,
    fields: fieldsOfJob("agents-md", j.name).map((key) => ({
      key,
      account: set(account[key]),
      ...(ws ? { workspace: set(ws[key]) } : {}),
      combine: COMBINE[key] ?? "workspace replaces",
      writable: writable.has(key) && !(workspace && COMBINE[key] === "account only"),
    })),
  }));
}
