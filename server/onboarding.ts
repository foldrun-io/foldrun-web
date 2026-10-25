// The facts onboarding-model.ts derives the getting-started steps from,
// read from where each thing really lives. Nothing here is written.

import { listWorkspaces, listFlows, listRunSummaries } from "@/lib/store";
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

export async function onboardingFacts(tenant: string): Promise<OnboardingFacts> {
  const workspaces = listWorkspaces(tenant).map((w) => w.name);
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

export async function onboardingFor(tenant: string): Promise<Onboarding> {
  return onboardingSteps(await onboardingFacts(tenant));
}

/** The pref key a person's dismissal is kept under. */
export const ONBOARDING_PREF = "onboardingDismissedAt";
