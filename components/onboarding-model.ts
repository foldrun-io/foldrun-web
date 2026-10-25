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
  model: { done: boolean } | null;
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
}

export interface Onboarding {
  steps: OnboardingStep[];
  done: number;
  total: number;
  complete: boolean;
  /** The first step not done, in order. */
  next: OnboardingStep | null;
}

export function onboardingSteps(f: OnboardingFacts): Onboarding {
  const ws = f.workspaces[0];
  const inWs = (page: string) => (ws ? `/dashboard/${encodeURIComponent(ws)}/${page}` : "/dashboard?create=workspace");
  const steps: OnboardingStep[] = [
    ...(f.model
      ? [
          {
            id: "model" as const,
            title: "Add your model key",
            why: "Agents run on your own API key from Anthropic, OpenAI or another provider; every run is refused until one is set.",
            href: "/dashboard/settings#provider",
            cli: "foldrun account model set anthropic --key …",
            done: f.model.done,
          },
        ]
      : []),
    {
      id: "workspace",
      title: "Create a workspace",
      why: "A workspace holds one desk's agents, flows, secrets and runs.",
      href: "/dashboard?create=workspace",
      cli: "foldrun init && foldrun deploy",
      done: f.workspaces.length > 0,
    },
    {
      id: "agent",
      title: "Write or deploy an agent",
      why: "An agent is one role in markdown: what it is for, its model and tools.",
      href: inWs("agents"),
      cli: "foldrun deploy",
      done: f.agentAuthored,
    },
    {
      id: "run",
      title: "Run a flow",
      why: "A flow is the steps in order; running one is how you see the agents work.",
      href: inWs("flows"),
      cli: "foldrun invoke <flow>",
      done: f.runs > 0,
    },
    {
      id: "success",
      title: "Get a run to finish",
      why: "A run that completes end to end is the proof the desk works.",
      href: "/dashboard/runs",
      cli: "foldrun runs",
      done: f.completedRuns > 0,
    },
    {
      id: "secret",
      title: "Add a secret",
      why: "API keys for the services your agents call live in the vault, never in the files.",
      href: "/dashboard/settings#secrets",
      cli: "foldrun secrets set <NAME>",
      done: f.secrets > 0,
    },
    {
      id: "trigger",
      title: "Schedule a flow or give it a webhook",
      why: "A desk earns its keep when it runs without you pressing the button.",
      href: inWs("triggers"),
      done: f.triggers > 0,
    },
    {
      id: "teammate",
      title: "Invite a teammate",
      why: "Someone else who can read the runs and approve the steps that wait for a person.",
      href: "/dashboard/settings#team",
      done: f.members > 1,
    },
    ...(f.billing
      ? [
          {
            id: "billing" as const,
            title: "Set up billing",
            why: "A saved card or a plan keeps runs going once the trial credit is spent.",
            href: "/dashboard/billing",
            done: f.billing.done,
          },
        ]
      : []),
    {
      id: "cli",
      title: "Install the CLI",
      why: "Edit agents as files in your own editor, check them offline and deploy from the terminal.",
      href: "/dashboard/settings#api-keys",
      cli: "npm i -g foldrun && foldrun login",
      done: f.cli,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length, next: steps.find((s) => !s.done) ?? null };
}
