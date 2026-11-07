// /dashboard/welcome — the first-run flow (cloudhost's /welcome): your
// model, what to start with, a first run watched live, what to do next.
// The home page sends a person here once, the first time they open an
// account with no workspace; the Getting started card's "Resume setup"
// brings them back. `?step=` opens one screen.
//
// Every screen reads the account's real state through onboarding-model.ts
// (welcomeFlow), so it ticks however the work was done and resumes where the
// account is. Nothing here is a second progress store.

import Link from "@/components/kit/link";
import { cookies, headers } from "next/headers";
import { verifySession, SESSION_COOKIE, viewerScope, viewerRole } from "@/server/users";
import { onboardingFor, onboardingPrefs } from "@/server/onboarding";
import { welcomeFlow } from "@/components/onboarding-model";
import { WelcomeFlow } from "@/components/welcome-flow";
import type { FirstRunTarget } from "@/components/first-run";
import { liteRun } from "@/components/flow-canvas-model";
import { runLite } from "@/server/run-lite";
import { listWorkspaces, listFlows, listRuns, runFailure } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { can } from "@/platform/permissions";
import { DEMO_WORKSPACE } from "@/platform/demo-workspace";
import { installOrigin } from "@/server/auth-flows";
import { describeAccountModel, modelPresetChoices } from "@/server/account-model";
import { foldrunModelsView } from "@/platform/model-choice";
import { ModelKey } from "../settings/model-key";
import { Page, PageHeader } from "@/components/kit/page";
import { buttonVariants } from "@/components/kit/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

/** What the First run step runs: the demo's flow when there is a demo, else
 *  the first workspace's first flow; and that flow's newest run. */
function firstRunTarget(tenant: string, workspaces: string[], chosen?: string): { target: FirstRunTarget | null; empty: string | null } {
  // The workspace the person just made or picked decides it alone: with no
  // flow yet, the step offers to build one there rather than running another.
  if (chosen && workspaces.includes(chosen) && !listFlows(tenant, chosen)[0]) return { target: null, empty: chosen };
  const first = chosen && workspaces.includes(chosen) ? chosen : workspaces.includes(DEMO_WORKSPACE) ? DEMO_WORKSPACE : null;
  const order = first ? [first, ...workspaces.filter((w) => w !== first)] : workspaces;
  for (const ws of order) {
    const flow = listFlows(tenant, ws)[0];
    if (!flow) continue;
    const run = listRuns(tenant, ws).find((r) => r.flow === flow.name) ?? null;
    return {
      target: {
        workspace: ws,
        flow: flow.name,
        steps: flow.steps.map((s) => ({ agent: s.agent, group: s.group })),
        latest: run ? { lite: liteRun(run), outcome: runLite({ ...run, workspace: ws }).outcome, failure: runFailure(run) } : null,
      },
      empty: null,
    };
  }
  return { target: null, empty: workspaces[0] ?? null };
}

export default async function Welcome({ searchParams }: { searchParams: Promise<{ tenant?: string; step?: string; workspace?: string }> }) {
  const { tenant = "default", step, workspace: chosen } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const scope = await viewerScope();
  const role = await viewerRole();
  const person = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const prefs = onboardingPrefs(person?.prefs);
  const onboarding = await onboardingFor(tenant, scope, prefs.hidden);
  const flow = welcomeFlow(onboarding, step, Boolean(person) && !prefs.welcomedAt);
  const workspaces = listWorkspaces(tenant)
    .map((w) => w.name)
    .filter((w) => scopeAllows(scope, w))
    .sort();
  const { target, empty } = firstRunTarget(tenant, workspaces, chosen);

  // The model screen is settings' own card, not a copy of it.
  const modelCard = flow.steps.some((s) => s.id === "model") ? (
    <ModelKey
      tenant={tenant}
      initial={{ ...describeAccountModel(tenant), foldrunModels: await foldrunModelsView(tenant) }}
      presets={modelPresetChoices()}
      mayEdit={role === null || can(role, "secrets:write")}
    />
  ) : null;

  const host = (await headers()).get("host");
  const origin = installOrigin() ?? (host ? `${/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https"}://${host}` : "https://<this install's address>");

  return (
    <Page>
      <PageHeader
        title="Welcome to foldrun"
        description="A few steps to a desk that works. Skip any of them; this page picks up wherever your account is."
        actions={
          <Link href={`/dashboard${qs}`} className={buttonVariants({ variant: "ghost" })}>
            Skip setup
          </Link>
        }
      />
      <WelcomeFlow
        tenant={tenant}
        flow={flow}
        onboarding={onboarding}
        modelCard={modelCard}
        workspaces={workspaces}
        demoExists={workspaces.includes(DEMO_WORKSPACE)}
        canCreate={role === null || can(role, "workspace:manage")}
        firstRun={target}
        emptyWorkspace={empty}
        demoWorkspace={DEMO_WORKSPACE}
        // --url always: right on every install, the hosted one included.
        cliLogin={`foldrun login --url ${origin}`}
        mcpUrl={`${origin}/api/mcp`}
      />
    </Page>
  );
}
