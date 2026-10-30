// The hosted plan's workspace count — one check for every door a new
// workspace comes through: POST /api/workspaces, …/import of a workspace
// package, and …/deploy to a name that does not exist yet (30 Oct 2026:
// deploy had none, so an editor could deploy past the plan's cap).
//
// Checked only for a NEW workspace — pushing to an existing one must never
// bounce off the limit, or a deploy to workspace N becomes an outage the
// moment the plan shrinks. The plan the platform's operator set for this
// customer first, else the install-wide default. A plan is a hosted concept:
// the `self-hosted` edition has no workspace cap however
// FOLDRUN_PLAN_WORKSPACES is set, because there is no plan.

import { listWorkspaces } from "@/lib/store";
import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { settingText } from "@/platform/settings";

/** The 402 message when making `name` would go past the plan's workspace
 *  count, or null when it may be made (or already exists). */
export async function workspaceCapRefusal(tenant: string, name: string): Promise<string | null> {
  const cap = (await billing().plan(tenant))?.workspaces ?? Number(settingText("FOLDRUN_PLAN_WORKSPACES"));
  if (!Number.isFinite(cap) || cap <= 0 || platform.edition() !== "hosted") return null;
  const existing = listWorkspaces(tenant);
  if (existing.some((w) => w.name === name) || existing.length < cap) return null;
  return `this plan includes ${cap} workspace${cap === 1 ? "" : "s"} — delete one or upgrade`;
}
