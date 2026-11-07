"use client";

// The welcome flow (/dashboard/welcome), cloudhost's first-run flow in
// foldrun's terms: your model, what to start with, a first run watched
// live, and what to do next. Every screen is skippable, and the flow
// resumes where the account really is — the rail ticks from the account's
// state (onboarding-model.ts welcomeFlow), never from a second progress
// store. The one thing kept is that this person has seen it, so the home
// page stops sending them here.

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Boxes, CircleCheck, FileArchive, KeyRound, PlugZap, Sparkles, Terminal } from "lucide-react";
import type { Onboarding, OnboardingStepId, WelcomeFlow as Flow, WelcomeStepId } from "./onboarding-model";
import { welcomeAfter } from "./onboarding-model";
import { StepRail, StepPanel, StepLayout, type RailStep } from "./kit/steps";
import { ChoiceCards } from "./kit/choice-cards";
import { CopyBlock } from "./kit/copy-block";
import { Callout } from "@/components/kit/page";
import { ChecklistCard } from "./kit/checklist";
import { STEP_ICON, withQs } from "./onboarding-card";
import { FirstRun, type FirstRunTarget } from "./first-run";
import { CreateForm } from "./create";
import { ImportPackageButton } from "./package-buttons";
import { DemoButton } from "@/app/dashboard/demo-button";
import { Button, buttonVariants } from "./kit/button";
import { Card, EmptyState } from "./kit/page";

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
    void fetch("/api/me/onboarding", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ welcomed: true }) }).catch(() => {});
  }, []);

  const rail: RailStep[] = p.flow.steps.map((s) => ({ key: s.id, label: s.title, state: s.id === cur ? "current" : s.done ? "done" : "todo", href: stepHref(s.id) }));
  const skip = after ? (
    <Button variant="ghost" size="md" onClick={next}>
      Skip
    </Button>
  ) : null;

  const kicker = `Step ${index + 1} of ${p.flow.steps.length}`;
  return (
    <StepLayout rail={<StepRail steps={rail} label="Setup steps" />}>

        {cur === "model" && (
          <StepPanel
            kicker={kicker}
            title="Add your model key"
            body="Agents run on your own API key from Anthropic, OpenAI or another provider. Until the account has one, every run is refused."
            actions={
              <>
                {p.flow.steps.find((s) => s.id === "model")?.done ? (
                  <Button variant="primary" size="md" onClick={next}>
                    Continue
                  </Button>
                ) : null}
                {!p.flow.steps.find((s) => s.id === "model")?.done && (
                  <Button variant="ghost" size="md" onClick={next}>
                    Skip for now
                  </Button>
                )}
              </>
            }
          >
            {p.flow.steps.find((s) => s.id === "model")?.done && <Done>This account has a model key. Runs can start.</Done>}
            <div className="[&>section]:mb-0">{p.modelCard}</div>
          </StepPanel>
        )}

        {cur === "start" && <StartStep {...p} kicker={kicker} done={p.flow.steps.find((s) => s.id === "start")?.done ?? false} next={next} skip={skip} stepHref={stepHref} qs={qs} />}

        {cur === "run" && (
          <StepPanel
            kicker={kicker}
            title="Run it once"
            body="Press Run it and watch each step work. A run is the flow's steps in order, each handed to the agent it names."
            actions={
              <>
                {p.flow.steps.find((s) => s.id === "run")?.done && (
                  <Button variant="primary" size="md" onClick={next}>
                    Continue
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
                title="Nothing to run yet"
                description={`${p.emptyWorkspace} has no flow. A flow is a numbered list of steps, each naming the agent that runs it.`}
                action={
                  <Link href={`/dashboard/${encodeURIComponent(p.emptyWorkspace)}/flows?create=flows${t ? `&${t}` : ""}`} className={buttonVariants({ variant: "primary", size: "md" })}>
                    Write a flow
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<Boxes />}
                title="No workspace yet"
                description="Start with the demo pipeline: four agents and a flow you can run in a minute."
                action={
                  <Link href={stepHref("start")} className={buttonVariants({ variant: "primary", size: "md" })}>
                    Choose how to start
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
      title="What do you want to start with?"
      body="Pick one to begin — the others stay a click away."
      actions={
        <>
          {p.done && (
            <Button variant="primary" size="md" onClick={p.next}>
              Continue
            </Button>
          )}
          {p.skip}
        </>
      }
    >
      {p.done && <Done>You have a workspace{p.workspaces[0] ? ` — ${p.workspaces[0]}` : ""}. Continue to run it.</Done>}
      <ChoiceCards
        label="What do you want to start with?"
        value={pick}
        onChange={(v) => setPick(v as Start)}
        options={[
          { value: "demo", title: "Demo pipeline", description: "Four agents and an approval gate. Runs in a minute.", icon: <Sparkles />, badge: p.demoExists ? "Ready" : "Recommended" },
          { value: "blank", title: "Blank workspace", description: "Write your own agents and flows from scratch.", icon: <Boxes /> },
          { value: "import", title: "Import", description: "A workspace, flow or agent exported as a .zip.", icon: <FileArchive /> },
          { value: "cli", title: "Use the CLI", description: "Agents as files in your editor; deploy from the terminal.", icon: <Terminal /> },
          { value: "mcp", title: "Connect your AI app", description: "Claude, Cursor or Codex drive this account as tools.", icon: <PlugZap /> },
        ]}
      />

      <Card className="p-5">
        {pick === "demo" && (
          <Choice
            text="A real pipeline, safe to play in: extract leads from a knowledge file, enrich and verify them in parallel, stop for your approval, then a pretend CRM import that sends nothing anywhere. Capped at $5 a month."
            action={
              p.demoExists ? (
                <Link href={runNext} className={buttonVariants({ variant: "primary", size: "md" })}>
                  Run the demo
                </Link>
              ) : p.canCreate ? (
                <DemoButton tenant={p.tenant} exists={false} then={runIn(p.demoWorkspace)} label="Create the demo" variant="primary" />
              ) : (
                <NoRights />
              )
            }
          />
        )}
        {pick === "blank" && (
          <Choice
            text="A workspace holds one desk's agents, flows, secrets and runs. You name it; it starts empty."
            action={
              p.canCreate ? (
                <CreateForm
                  noun="workspace"
                  label="Create a workspace"
                  placeholder="marketing"
                  hint="Its own agents, flows, secrets and runs. Starts blank: import agents from another workspace, or create them."
                  tenant={p.tenant}
                  options={[{ where: "account", label: "Account", target: { endpoint: "/api/workspaces", body: { template: true, ifAbsent: true } } }]}
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
                A .zip exported from foldrun — a whole workspace, one flow or one agent. You see what it would add before anything is written.
                {p.workspaces[0] && (
                  <>
                    {" "}
                    To copy an agent from a workspace you already have, use{" "}
                    <Link href={`/dashboard/${encodeURIComponent(p.workspaces[0])}/agents${p.qs}`} className="text-link hover:underline">
                      Agents → Import
                    </Link>
                    .
                  </>
                )}
              </>
            }
            action={p.canCreate ? <ImportPackageButton tenant={p.tenant} newWorkspace label="Import a .zip" color="primary" /> : <NoRights />}
          />
        )}
        {pick === "cli" && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              An account is a folder of markdown: edit agents in your own editor, check them offline with <code className="font-mono text-[13px]">foldrun check</code>, and deploy.
            </p>
            <CopyBlock
              items={[
                { label: "Install", value: "npm install -g foldrun" },
                { label: "Sign this machine in", value: p.cliLogin },
                { label: "Make an account folder", value: "foldrun init my-account" },
                { label: "Push it here", value: "cd my-account && foldrun deploy" },
              ]}
            />
            <Link href={`/dashboard/docs/getting-started${p.qs}`} className="inline-flex items-center gap-1.5 text-sm text-link hover:underline">
              <BookOpen className="size-4" aria-hidden />
              Getting started with the CLI
            </Link>
          </div>
        )}
        {pick === "mcp" && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Claude Code, Claude Desktop, Cursor and Codex can use this account as tools: your inbox, approvals, runs and flows.</p>
            <CopyBlock
              items={[
                { label: "With this machine's foldrun sign-in", value: "claude mcp add foldrun -- foldrun mcp" },
                { label: "Or straight to this install, with an API key", value: `claude mcp add --transport http foldrun ${p.mcpUrl} --header "Authorization: Bearer <API key>"` },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/settings?${p.qs ? `${p.qs.slice(1)}&` : ""}tab=api#mcp`} className={buttonVariants({ size: "md" })}>
                <KeyRound aria-hidden />
                Keys and connections
              </Link>
              <Link href={`/dashboard/docs/mcp${p.qs}`} className={buttonVariants({ variant: "ghost", size: "md" })}>
                <BookOpen aria-hidden />
                MCP docs
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
  return <p className="text-sm text-fg-muted">Ask an admin — your role cannot create workspaces.</p>;
}

// ---- Next ----

const NEXT: { id: OnboardingStepId; title: string }[] = [
  { id: "teammate", title: "Invite a teammate" },
  { id: "trigger", title: "Schedule a flow or give it a webhook" },
  { id: "secret", title: "Add a secret" },
];

function NextStep({ kicker, onboarding, qs, firstWorkspace }: { kicker: string; onboarding: Onboarding; qs: string; firstWorkspace: string | null }) {
  const rows = NEXT.map((n) => {
    const step = onboarding.steps.find((s) => s.id === n.id);
    return { key: n.id, label: n.title, hint: step?.why, icon: STEP_ICON[n.id], href: withQs(step?.href ?? "/dashboard", qs), done: step?.done ?? false };
  });
  return (
    <StepPanel
      kicker={kicker}
      title="What next"
      body="These make a desk run on its own, with the people and keys it needs. Each opens where it is done."
      actions={
        <>
          <Link href={`/dashboard${qs}`} className={buttonVariants({ variant: "primary", size: "md" })}>
            {firstWorkspace ? "Go to the dashboard" : "Finish"}
          </Link>
          <Link href={`/dashboard/docs${qs}`} className={buttonVariants({ variant: "ghost", size: "md" })}>
            <BookOpen aria-hidden />
            Open docs
          </Link>
        </>
      }
    >
      <ChecklistCard title="Make it run on its own" rows={rows} />
    </StepPanel>
  );
}
