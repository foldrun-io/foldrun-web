import { $t } from "@/i18n";
// Getting started: the steps a new account goes through, each derived from
// what is really there — a workspace on disk, a run on record, a secret in
// the vault — never from a checklist someone ticks. So a step is done the
// moment the thing is done, by whatever route (dashboard, CLI, git push,
// API), and there is no progress store to drift out of step with the
// account. The one thing stored is a person's choice to hide the card.
//
// Pure: facts in, steps out. server/onboarding.ts gathers the facts.

export interface OnboardingFacts {
  /** Null: the account runs on the platform's credential and has nothing
   *  to bring. Otherwise done once it has its own key or an account-wide
   *  provider: block — until then every run is refused. */
  model: { done: boolean; /** Own keys are off here: the account needs a plan, not a key. */ needsPlan?: boolean } | null;
  workspaces: string[];
  /** An agent written or changed after a workspace was made, by any route. */
  agentAuthored: boolean;
  runs: number;
  completedRuns: number;
  secrets: number;
  /** Flows with a schedule or webhook trigger. */
  triggers: number;
  members: number;
  /** Null: billing is not something this install asks for (community
   *  edition, or the account is fully waived). */
  billing: { done: boolean } | null;
  /** Any API key or CLI login minted for the account. */
  cli: boolean;
}

export type OnboardingStepId =
  | "model"
  | "workspace"
  | "agent"
  | "run"
  | "success"
  | "secret"
  | "trigger"
  | "teammate"
  | "billing"
  | "cli";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  why: string;
  /** Where to do it, as a dashboard path (the caller adds ?tenant=). */
  href: string;
  /** The CLI's way to do it, when there is one. */
  cli?: string;
  done: boolean;
  /** This person hid the step from their card (it still counts, and still
   *  ticks itself when done). Always false for a key. */
  hidden: boolean;
}

export interface Onboarding {
  steps: OnboardingStep[];
  done: number;
  total: number;
  complete: boolean;
  /** The first step not done, in order. */
  next: OnboardingStep | null;
  /** The first step neither done nor hidden by this person — what the card
   *  offers next. Null once every step is done or hidden. */
  upNext: OnboardingStep | null;
  /** The step ids this person hid. */
  hidden: OnboardingStepId[];
}

export const ONBOARDING_STEP_IDS: readonly OnboardingStepId[] = ["model", "workspace", "agent", "run", "success", "secret", "trigger", "teammate", "billing", "cli"];

export function isOnboardingStepId(v: unknown): v is OnboardingStepId {
  return typeof v === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(v);
}

/** `hidden`: the step ids this person hid from their card (prefs). */
export function onboardingSteps(f: OnboardingFacts, hidden: readonly string[] = []): Onboarding {
  const ws = f.workspaces[0];
  const inWs = (page: string) => (ws ? `/dashboard/${encodeURIComponent(ws)}/${page}` : "/dashboard/welcome?step=start");
  const raw: Omit<OnboardingStep, "hidden">[] = [
    ...(f.model
      ? [
          f.model.needsPlan
            ? {
                id: "model" as const,
                title: $t("components.onboarding-model.getAPlan"),
                why: $t("components.onboarding-model.thisPlatformRunsEveryModelCall"),
                href: "/dashboard/billing/plans",
                done: f.model.done,
              }
            : {
                id: "model" as const,
                title: $t("components.onboarding-model.addYourModelKey"),
                why: $t("components.onboarding-model.agentsRunOnYourOwnApi"),
                href: "/dashboard/settings?tab=models#provider",
                cli: $t("components.onboarding-model.foldrunAccountModelSetAnthropicKey"),
                done: f.model.done,
              },
        ]
      : []),
    {
      id: "workspace",
      title: $t("components.onboarding-model.createAWorkspace"),
      why: $t("components.onboarding-model.aWorkspaceHoldsOneDeskS"),
      href: "/dashboard/welcome?step=start",
      cli: $t("components.onboarding-model.foldrunInitFoldrunDeploy"),
      done: f.workspaces.length > 0,
    },
    {
      id: "agent",
      title: $t("components.onboarding-model.writeOrDeployAnAgent"),
      why: $t("components.onboarding-model.anAgentIsOneRoleIn"),
      href: inWs("agents"),
      cli: $t("components.onboarding-model.foldrunDeploy"),
      done: f.agentAuthored,
    },
    {
      id: "run",
      title: $t("components.onboarding-model.runAFlow"),
      why: $t("components.onboarding-model.aFlowIsTheStepsIn"),
      href: inWs("flows"),
      cli: $t("components.onboarding-model.foldrunInvokeFlow"),
      done: f.runs > 0,
    },
    {
      id: "success",
      title: $t("components.onboarding-model.getARunToFinish"),
      why: $t("components.onboarding-model.aRunThatCompletesEndTo"),
      href: "/dashboard/runs",
      cli: $t("components.onboarding-model.foldrunRuns"),
      done: f.completedRuns > 0,
    },
    {
      id: "secret",
      title: $t("components.onboarding-model.addASecret"),
      why: $t("components.onboarding-model.apiKeysForTheServicesYour"),
      href: "/dashboard/settings?tab=secrets#secrets",
      cli: $t("components.onboarding-model.foldrunSecretsSetName"),
      done: f.secrets > 0,
    },
    {
      id: "trigger",
      title: $t("components.onboarding-model.scheduleAFlowOrGiveIt"),
      why: $t("components.onboarding-model.aDeskEarnsItsKeepWhen"),
      href: inWs("triggers"),
      done: f.triggers > 0,
    },
    {
      id: "teammate",
      title: $t("components.onboarding-model.inviteATeammate"),
      why: $t("components.onboarding-model.someoneElseWhoCanReadThe"),
      href: "/dashboard/settings?tab=team#team",
      done: f.members > 1,
    },
    ...(f.billing
      ? [
          {
            id: "billing" as const,
            title: $t("components.onboarding-model.setUpBilling"),
            why: $t("components.onboarding-model.aSavedCardOrAPlan"),
            href: "/dashboard/billing",
            done: f.billing.done,
          },
        ]
      : []),
    {
      id: "cli",
      title: $t("components.onboarding-model.installTheCli"),
      why: $t("components.onboarding-model.editAgentsAsFilesInYour"),
      href: "/dashboard/settings?tab=api#api-keys",
      cli: $t("components.onboarding-model.npmIGFoldrunFoldrunLogin"),
      done: f.cli,
    },
  ];
  const steps: OnboardingStep[] = raw.map((s) => ({ ...s, hidden: hidden.includes(s.id) }));
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done) ?? null,
    upNext: steps.find((s) => !s.done && !s.hidden) ?? null,
    hidden: steps.filter((s) => s.hidden).map((s) => s.id),
  };
}

// ---- the welcome flow (/dashboard/welcome) ----
//
// Four screens over the same steps, never a second progress store: each
// screen is done when the steps under it are, so the flow resumes wherever
// the account really is, by whatever route the work was done.

export type WelcomeStepId = "model" | "start" | "run" | "next";

export interface WelcomeStep {
  id: WelcomeStepId;
  title: string;
  done: boolean;
}

export interface WelcomeFlow {
  steps: WelcomeStep[];
  /** The screen to show: the one asked for (?step=) when it is in the flow,
   *  else the first not done, else the last. */
  current: WelcomeStepId;
}

const doneOf = (o: Onboarding, id: OnboardingStepId) => o.steps.find((s) => s.id === id)?.done ?? false;

/** `firstVisit`: this person has not opened the flow before — it starts at
 *  the beginning, ticks and all, rather than skipping to the first screen
 *  not done (a new account already has its template workspace, and the
 *  choices on Start with are still worth a look). */
export function welcomeFlow(o: Onboarding, asked?: string | null, firstVisit = false): WelcomeFlow {
  const hasModel = o.steps.some((s) => s.id === "model");
  const steps: WelcomeStep[] = [
    ...(hasModel ? [{ id: "model" as const, title: $t("components.onboarding-model.yourModel"), done: doneOf(o, "model") }] : []),
    { id: "start", title: $t("components.onboarding-model.startWith"), done: doneOf(o, "workspace") },
    { id: "run", title: $t("components.onboarding-model.firstRun"), done: doneOf(o, "success") },
    { id: "next", title: $t("components.onboarding-model.next"), done: doneOf(o, "teammate") && doneOf(o, "trigger") && doneOf(o, "secret") },
  ];
  const pick = steps.find((s) => s.id === asked);
  const current = pick?.id ?? (firstVisit ? steps[0].id : (steps.find((s) => !s.done)?.id ?? "next"));
  return { steps, current };
}

/** The screen after `id` in the flow, or null after the last. */
export function welcomeAfter(flow: WelcomeFlow, id: WelcomeStepId): WelcomeStepId | null {
  const i = flow.steps.findIndex((s) => s.id === id);
  return i >= 0 && i < flow.steps.length - 1 ? flow.steps[i + 1].id : null;
}
