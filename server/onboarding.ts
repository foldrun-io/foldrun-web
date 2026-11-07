// The facts onboarding-model.ts derives the getting-started steps from,
// read from where each thing really lives. Nothing here is written.

import { notifyConfig } from "@/lib/notify";
import { listEvals } from "@/lib/evals";
import { listWorkspaces, listFlows, listRunSummaries, workspaceDir, accountDir, resolveOwner } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsOf } from "@/components/defaults-model";
import { workspaceChecklist, type WorkspaceChecklist, type WorkspaceChecklistFacts } from "@/components/workspace-checklist-model";
import { scopeAllows } from "@/platform/scope";
import { listSecrets } from "@/lib/secrets";
import { listRevisions } from "@/lib/history";
import { deployedCommit } from "@/lib/deploy";
import { platform } from "@/lib/platform";
import { paymentStep } from "@/server/billing-notices";
import { onboardingSteps, type Onboarding, type OnboardingFacts } from "@/components/onboarding-model";
import { listApiKeys } from "./auth.ts";
import { listMembers } from "./users.ts";
import { accountModelSupply } from "./account-model.ts";

const AGENT_PATH = /^(agents\/|\.claude\/agents\/|\.agents\/agents\/)/;

/**
 * An agent someone wrote: a pushed or CLI-deployed commit, or any change to
 * an agent file after the workspace's first revision (which is the template
 * a new workspace starts with — its example agents are not the person's).
 */
function agentAuthored(tenant: string, workspace: string): boolean {
  if (deployedCommit(tenant, workspace)) return true;
  const revs = listRevisions(tenant, workspace, { limit: 200 });
  return revs.slice(0, -1).some((r) => r.paths.some((p) => AGENT_PATH.test(p)));
}

/** `scope`: the caller's workspaces (null: all). A caller limited to some
 *  is told about those alone — the steps' links name the first workspace,
 *  and it used to be any of the account's (30 Oct 2026). */
export async function onboardingFacts(tenant: string, scope: string[] | null = null): Promise<OnboardingFacts> {
  // Sorted: the steps link the first one, and a directory listing has no
  // order of its own (the same account linked a different workspace from one
  // filesystem to the next).
  const workspaces = listWorkspaces(tenant).map((w) => w.name).filter((w) => scopeAllows(scope, w)).sort();
  let runs = 0;
  let completedRuns = 0;
  let triggers = 0;
  let secrets = listSecrets(tenant).length;
  let authored = false;
  for (const w of workspaces) {
    for (const r of listRunSummaries(tenant, w)) {
      runs++;
      if (r.status === "completed") completedRuns++;
    }
    triggers += listFlows(tenant, w).filter((f) => f.trigger === "schedule" || f.trigger === "webhook").length;
    secrets += listSecrets(tenant, w).filter((s) => s.scope === "workspace").length;
    if (!authored) authored = agentAuthored(tenant, w);
  }
  // The payment step is billing's to decide (billing-notices.ts); without
  // billing there is none.
  const payment: OnboardingFacts["billing"] = platform.edition() === "hosted" ? await paymentStep(tenant) : null;
  const supply = accountModelSupply(tenant);
  return {
    // An account that has never had to bring a key (the operator's, on the
    // platform's credential) is not asked for one.
    model: supply === "platform" ? null : { done: supply !== "none" },
    workspaces,
    agentAuthored: authored,
    runs,
    completedRuns,
    secrets,
    triggers,
    members: (await listMembers(tenant)).length,
    billing: payment,
    cli: (await listApiKeys(tenant)).length > 0,
  };
}

/** `hidden`: the steps this person hid (onboardingPrefs(...).hidden). */
export async function onboardingFor(tenant: string, scope: string[] | null = null, hidden: readonly string[] = []): Promise<Onboarding> {
  return onboardingSteps(await onboardingFacts(tenant, scope), hidden);
}

/** A workspace's checklist facts, read from where each thing lives. */
export function workspaceChecklistFacts(tenant: string, workspace: string): WorkspaceChecklistFacts {
  let completedRuns = 0;
  for (const r of listRunSummaries(tenant, workspace)) if (r.status === "completed") completedRuns++;
  const triggers = listFlows(tenant, workspace).filter((f) => f.trigger === "schedule" || f.trigger === "webhook").length;
  const own = defaultsOf(readAgentsMdKeys(workspaceDir(tenant, workspace)));
  const account = defaultsOf(readAgentsMdKeys(accountDir(tenant)));
  // What the sender itself will use (workspace notify: replaces the
  // account's; a bare string is a destination with the default events), and
  // only when it would actually send a failure.
  const notify = notifyConfig(tenant, workspace);
  // A flow's saved inputs (`inputs: true`) live in evals/ but test nothing,
  // exactly as the Evals page leaves them out.
  const evals = listEvals(tenant, workspace).filter((e) => !e.inputs).length;
  return {
    workspace,
    completedRuns,
    triggers,
    owner: resolveOwner(undefined, own.owner, account.owner).owner,
    evals,
    notify: Boolean(notify && (notify.url || notify.email) && notify.events.includes("failed")),
  };
}

export function workspaceChecklistFor(tenant: string, workspace: string, prefs: OnboardingPrefs = NO_PREFS): WorkspaceChecklist {
  const mine = prefs.checklists[workspace];
  return workspaceChecklist(workspaceChecklistFacts(tenant, workspace), { hidden: mine?.hidden ?? [], dismissed: Boolean(mine?.dismissedAt) });
}

/** The pref key a person's dismissal is kept under. */
export const ONBOARDING_PREF = "onboardingDismissedAt";
/** When this person first opened the welcome flow — the home page sends a
 *  first-timer there once, and never again after this is set. */
export const ONBOARDING_WELCOMED_PREF = "onboardingWelcomedAt";
/** The getting-started steps this person hid from their card. */
export const ONBOARDING_HIDDEN_PREF = "onboardingHidden";
/** Per workspace: this person hid its checklist, or some of its items. */
export const ONBOARDING_CHECKLISTS_PREF = "onboardingChecklists";

export interface OnboardingPrefs {
  dismissedAt: string | null;
  welcomedAt: string | null;
  hidden: string[];
  checklists: Record<string, { dismissedAt?: string; hidden?: string[] }>;
}

const NO_PREFS: OnboardingPrefs = { dismissedAt: null, welcomedAt: null, hidden: [], checklists: {} };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A person's onboarding choices, read defensively out of their prefs (a
 *  key, which is nobody, has none). */
export function onboardingPrefs(prefs: Record<string, unknown> | null | undefined): OnboardingPrefs {
  if (!prefs) return NO_PREFS;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const lists: OnboardingPrefs["checklists"] = {};
  const raw = prefs[ONBOARDING_CHECKLISTS_PREF];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [ws, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const entry: { dismissedAt?: string; hidden?: string[] } = {};
      if (str(o.dismissedAt)) entry.dismissedAt = str(o.dismissedAt)!;
      if (strings(o.hidden).length) entry.hidden = strings(o.hidden);
      if (entry.dismissedAt || entry.hidden) lists[ws] = entry;
    }
  }
  return {
    dismissedAt: str(prefs[ONBOARDING_PREF]),
    welcomedAt: str(prefs[ONBOARDING_WELCOMED_PREF]),
    hidden: strings(prefs[ONBOARDING_HIDDEN_PREF]),
    checklists: lists,
  };
}
