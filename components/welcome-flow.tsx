"use client";

// The welcome flow (/dashboard/welcome), cloudhost's first-run flow in
// foldrun's terms: your model, what to start with, a first run watched
// live, and what to do next. Every screen is skippable, and the flow
// resumes where the account really is — the rail ticks from the account's
// state (onboarding-model.ts welcomeFlow), never from a second progress
// store. The one thing kept is that this person has seen it, so the home
// page stops sending them here.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Boxes, CircleCheck, FileArchive, KeyRound, PlugZap, Sparkles, Terminal } from "lucide-react";
import type { Onboarding, OnboardingStepId, WelcomeFlow as Flow, WelcomeStepId } from "./onboarding-model";
import { welcomeAfter } from "./onboarding-model";
import { StepRail, StepPanel, StepLayout, type RailStep } from "@foldrun/ui/react/steps";
import { ChoiceCards } from "@foldrun/ui/react/choice-cards";
import { CopyBlock } from "@foldrun/ui/react/copy-block";
import { Callout } from "@foldrun/ui/react/page";
import { ChecklistCard } from "@foldrun/ui/react/checklist";
import { STEP_ICON, withQs } from "./onboarding-card";
import { FirstRun, type FirstRunTarget } from "./first-run";
import { CreateForm } from "./create";
import { ImportPackageButton } from "./package-buttons";
import { DemoButton } from "@/app/dashboard/demo-button";
import { Button, buttonVariants } from "@foldrun/ui/react/button";
import { Card, EmptyState } from "@foldrun/ui/react/page";

export interface WelcomeProps {
  tenant: string;
  flow: Flow;
  onboarding: Onboarding;
  /** The model key card (settings' own ModelKey), drawn by the server. */
  modelCard: ReactNode | null;
  workspaces: string[];
  demoExists: boolean;
  /** May create workspaces (workspace:manage). */
  canCreate: boolean;
  firstRun: FirstRunTarget | null;
  /** The first workspace, when it has no flow to run. */
  emptyWorkspace: string | null;
  /** The demo workspace's name (DEMO_WORKSPACE), carried into First run. */
  demoWorkspace: string;
  /** `foldrun login`, with --url when this install is not the default. */
  cliLogin: string;
  /** This install's MCP address. */
  mcpUrl: string;
}

type Start = "demo" | "blank" | "import" | "cli" | "mcp";

export function WelcomeFlow(p: WelcomeProps) {
  const router = useRouter();
  const t = p.tenant !== "default" ? `tenant=${encodeURIComponent(p.tenant)}` : "";
  const qs = t ? `?${t}` : "";
  const stepHref = (s: WelcomeStepId) => `/dashboard/welcome?step=${s}${t ? `&${t}` : ""}`;
  const go = (s: WelcomeStepId | null) => router.push(s ? stepHref(s) : `/dashboard${qs}`, { scroll: true });
  const cur = p.flow.current;
  const index = p.flow.steps.findIndex((s) => s.id === cur);
  const after = welcomeAfter(p.flow, cur);
  const next = () => go(after);

  // Seen: the home page sends a first-timer here once. A key or dev mode
  // has no person to remember it for; that 401 is nothing to show.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    void fetch("/v1/me/onboarding", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ welcomed: true }) }).catch(() => {});
  }, []);

  const rail: RailStep[] = p.flow.steps.map((s) => ({ key: s.id, label: s.title, state: s.id === cur ? "current" : s.done ? "done" : "todo", href: stepHref(s.id) }));
  const skip = after ? (
    <Button variant="ghost" size="md" onClick={next}>
      {$t("components.welcome-flow.skip")}
    </Button>
  ) : null;

  const kicker = $t("components.welcome-flow.stepOf", { v0: String(index + 1), length: String(p.flow.steps.length) });
  return (
    <StepLayout rail={<StepRail steps={rail} label={$t("components.welcome-flow.setupSteps")} />}>

        {cur === "model" && (
          <StepPanel
            kicker={kicker}
            title={$t("components.welcome-flow.addYourModelKey")}
            body={$t("components.welcome-flow.agentsRunOnYourOwnApi")}
            actions={
              <>
                {p.flow.steps.find((s) => s.id === "model")?.done ? (
                  <Button variant="primary" size="md" onClick={next}>
                    {$t("components.welcome-flow.continue")}
                  </Button>
                ) : null}
                {!p.flow.steps.find((s) => s.id === "model")?.done && (
                  <Button variant="ghost" size="md" onClick={next}>
                    {$t("components.welcome-flow.skipForNow")}
                  </Button>
                )}
              </>
            }
          >
            {p.flow.steps.find((s) => s.id === "model")?.done && <Done>{$t("components.welcome-flow.thisAccountHasAModelKey")}</Done>}
            <div className="[&>section]:mb-0">{p.modelCard}</div>
          </StepPanel>
        )}

        {cur === "start" && <StartStep {...p} kicker={kicker} done={p.flow.steps.find((s) => s.id === "start")?.done ?? false} next={next} skip={skip} stepHref={stepHref} qs={qs} />}

        {cur === "run" && (
          <StepPanel
            kicker={kicker}
            title={$t("components.welcome-flow.runItOnce")}
            body={$t("components.welcome-flow.pressRunItAndWatchEach")}
            actions={
              <>
                {p.flow.steps.find((s) => s.id === "run")?.done && (
                  <Button variant="primary" size="md" onClick={next}>
                    {$t("components.welcome-flow.continue")}
                  </Button>
                )}
                {skip}
              </>
            }
          >
            {p.firstRun ? (
              <FirstRun
                tenant={p.tenant}
                target={p.firstRun}
                noModel={p.onboarding.steps.some((s) => s.id === "model" && !s.done)}
                modelHref={p.flow.steps.some((s) => s.id === "model") ? stepHref("model") : null}
                onContinue={next}
              />
            ) : p.emptyWorkspace ? (
              <EmptyState
                icon={<Sparkles />}
                title={$t("components.welcome-flow.nothingToRunYet")}
                description={$t("components.welcome-flow.hasNoFlowAFlowIs", { emptyWorkspace: String(p.emptyWorkspace) })}
                action={
                  <Link href={`/dashboard/${encodeURIComponent(p.emptyWorkspace)}/flows?create=flows${t ? `&${t}` : ""}`} className={buttonVariants({ variant: "primary", size: "md" })}>
                    {$t("components.welcome-flow.writeAFlow")}
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Boxes />}
                title={$t("components.welcome-flow.noWorkspaceYet")}
                description={$t("components.welcome-flow.startWithTheDemoPipelineFour")}
                action={
                  <Link href={stepHref("start")} className={buttonVariants({ variant: "primary", size: "md" })}>
                    {$t("components.welcome-flow.chooseHowToStart")}
                  </Link>
                }
              />
            )}
          </StepPanel>
        )}

        {cur === "next" && <NextStep kicker={kicker} onboarding={p.onboarding} qs={qs} firstWorkspace={p.workspaces[0] ?? null} />}
    </StepLayout>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <Callout tone="success" icon={<CircleCheck />}>
      {children}
    </Callout>
  );
}

// ---- Start with ----

function StartStep(p: WelcomeProps & { kicker: string; done: boolean; next: () => void; skip: ReactNode; stepHref: (s: WelcomeStepId) => string; qs: string }) {
  const [pick, setPick] = useState<Start>("demo");
  const runNext = p.stepHref("run");
  // Carry the workspace the person just chose into First run, so it runs (or
  // offers to build) that one — not an older demo already in the account.
  const runIn = (ws: string) => `${runNext}${runNext.includes("?") ? "&" : "?"}workspace=${ws}`;
  return (
    <StepPanel
      kicker={p.kicker}
      title={$t("components.welcome-flow.whatDoYouWantToStart")}
      body={$t("components.welcome-flow.pickOneToBeginTheOthers")}
      actions={
        <>
          {p.done && (
            <Button variant="primary" size="md" onClick={p.next}>
              {$t("components.welcome-flow.continue")}
            </Button>
          )}
          {p.skip}
        </>
      }
    >
      {p.done && <Done>{$t("components.welcome-flow.youHaveAWorkspace")}{p.workspaces[0] ? ` — ${p.workspaces[0]}` : ""}{$t("components.welcome-flow.continueToRunIt")}</Done>}
      <ChoiceCards
        label={$t("components.welcome-flow.whatDoYouWantToStart")}
        value={pick}
        onChange={(v) => setPick(v as Start)}
        options={[
          { value: "demo", title: $t("components.welcome-flow.demoPipeline"), description: $t("components.welcome-flow.fourAgentsAndAnApprovalGate"), icon: <Sparkles />, badge: p.demoExists ? $t("components.welcome-flow.ready") : $t("components.welcome-flow.recommended") },
          { value: "blank", title: $t("components.welcome-flow.blankWorkspace"), description: $t("components.welcome-flow.writeYourOwnAgentsAndFlows"), icon: <Boxes /> },
          { value: "import", title: $t("components.welcome-flow.import"), description: $t("components.welcome-flow.aWorkspaceFlowOrAgentExported"), icon: <FileArchive /> },
          { value: "cli", title: $t("components.welcome-flow.useTheCli"), description: $t("components.welcome-flow.agentsAsFilesInYourEditor"), icon: <Terminal /> },
          { value: "mcp", title: $t("components.welcome-flow.connectYourAiApp"), description: $t("components.welcome-flow.claudeCursorOrCodexDriveThis"), icon: <PlugZap /> },
        ]}
      />

      <Card className="p-5">
        {pick === "demo" && (
          <Choice
            text={$t("components.welcome-flow.aRealPipelineSafeToPlay")}
            action={
              p.demoExists ? (
                <Link href={runNext} className={buttonVariants({ variant: "primary", size: "md" })}>
                  {$t("components.welcome-flow.runTheDemo")}
                </Link>
              ) : p.canCreate ? (
                <DemoButton tenant={p.tenant} exists={false} then={runIn(p.demoWorkspace)} label={$t("components.welcome-flow.createTheDemo")} variant="primary" />
              ) : (
                <NoRights />
              )
            }
          />
        )}
        {pick === "blank" && (
          <Choice
            text={$t("components.welcome-flow.aWorkspaceHoldsOneDeskS")}
            action={
              p.canCreate ? (
                <CreateForm
                  noun={$t("common.workspaceOne")}
                  label={$t("components.welcome-flow.createAWorkspace")}
                  placeholder="marketing"
                  hint={$t("components.welcome-flow.itsOwnAgentsFlowsSecretsAnd")}
                  tenant={p.tenant}
                  options={[{ where: "account", label: $t("components.welcome-flow.account"), target: { endpoint: "/v1/workspaces", body: { template: true, ifAbsent: true } } }]}
                  then={runIn("{name}")}
                />
              ) : (
                <NoRights />
              )
            }
          />
        )}
        {pick === "import" && (
          <Choice
            text={
              <>
                {$t("components.welcome-flow.aZipExportedFromFoldrunA")}
                {p.workspaces[0] && (
                  <>
                    {" "}{$rich("components.welcome-flow.toCopyAnAgentFromA2", { link: (chunks) => <Link href={`/dashboard/${encodeURIComponent(p.workspaces[0])}/agents${p.qs}`} className="text-link hover:underline">{chunks}</Link> })}
                  </>
                )}
              </>
            }
            action={p.canCreate ? <ImportPackageButton tenant={p.tenant} newWorkspace label={$t("components.welcome-flow.importAZip")} color="primary" /> : <NoRights />}
          />
        )}
        {pick === "cli" && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              {$rich("components.welcome-flow.anAccountIsAFolderOf", { code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code> })}
            </p>
            <CopyBlock
              items={[
                { label: $t("components.welcome-flow.install"), value: $t("components.welcome-flow.npmInstallGFoldrun") },
                { label: $t("components.welcome-flow.signThisMachineIn"), value: p.cliLogin },
                { label: $t("components.welcome-flow.makeAnAccountFolder"), value: $t("components.welcome-flow.foldrunInitMyAccount") },
                { label: $t("components.welcome-flow.pushItHere"), value: $t("components.welcome-flow.cdMyAccountFoldrunDeploy") },
              ]}
            />
            <Link href={`/dashboard/docs/getting-started${p.qs}`} className="inline-flex items-center gap-1.5 text-sm text-link hover:underline">
              <BookOpen className="size-4" aria-hidden />
              {$t("components.welcome-flow.gettingStartedWithTheCli")}
            </Link>
          </div>
        )}
        {pick === "mcp" && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">{$t("components.welcome-flow.claudeCodeClaudeDesktopCursorAnd")}</p>
            <CopyBlock
              items={[
                { label: $t("components.welcome-flow.withThisMachineSFoldrunSign"), value: $t("components.welcome-flow.claudeMcpAddFoldrunFoldrunMcp") },
                { label: $t("components.welcome-flow.orStraightToThisInstallWith"), value: $t("components.welcome-flow.claudeMcpAddTransportHttpFoldrun", { mcpUrl: String(p.mcpUrl) }) },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/settings?${p.qs ? `${p.qs.slice(1)}&` : ""}tab=api#mcp`} className={buttonVariants({ size: "md" })}>
                <KeyRound aria-hidden />
                {$t("components.welcome-flow.keysAndConnections")}
              </Link>
              <Link href={`/dashboard/docs/mcp${p.qs}`} className={buttonVariants({ variant: "ghost", size: "md" })}>
                <BookOpen aria-hidden />
                {$t("components.welcome-flow.mcpDocs")}
              </Link>
            </div>
          </div>
        )}
      </Card>
    </StepPanel>
  );
}

function Choice({ text, action }: { text: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-sm text-fg-muted">{text}</p>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function NoRights() {
  return <p className="text-sm text-fg-muted">{$t("components.welcome-flow.askAnAdminYourRoleCannot")}</p>;
}

// ---- Next ----

const NEXT: { id: OnboardingStepId; title: string }[] = [
  { id: "teammate", title: $t("components.welcome-flow.inviteATeammate") },
  { id: "trigger", title: $t("components.welcome-flow.scheduleAFlowOrGiveIt") },
  { id: "secret", title: $t("components.welcome-flow.addASecret") },
];

function NextStep({ kicker, onboarding, qs, firstWorkspace }: { kicker: string; onboarding: Onboarding; qs: string; firstWorkspace: string | null }) {
  const rows = NEXT.map((n) => {
    const step = onboarding.steps.find((s) => s.id === n.id);
    return { key: n.id, label: n.title, hint: step?.why, icon: STEP_ICON[n.id], href: withQs(step?.href ?? "/dashboard", qs), done: step?.done ?? false };
  });
  return (
    <StepPanel
      kicker={kicker}
      title={$t("components.welcome-flow.whatNext")}
      body={$t("components.welcome-flow.theseMakeADeskRunOn")}
      actions={
        <>
          <Link href={`/dashboard${qs}`} className={buttonVariants({ variant: "primary", size: "md" })}>
            {firstWorkspace ? $t("components.welcome-flow.goToTheDashboard") : $t("components.welcome-flow.finish")}
          </Link>
          <Link href={`/dashboard/docs${qs}`} className={buttonVariants({ variant: "ghost", size: "md" })}>
            <BookOpen aria-hidden />
            {$t("components.welcome-flow.openDocs")}
          </Link>
        </>
      }
    >
      <ChecklistCard title={$t("components.welcome-flow.makeItRunOnItsOwn")} rows={rows} />
    </StepPanel>
  );
}
