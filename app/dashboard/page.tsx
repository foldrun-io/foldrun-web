// The account overview. Top to bottom, the questions a person running
// agents asks, each answered once:
//
//   the status line   — is it all right, what is running, what is next, money
//   Needs attention   — what is broken or waiting, platform's fault or desk's
//   Now & next        — running now and the next fires
//   Desks             — every workspace, its last runs as a strip
//
// It used to answer most of these two or three times (Alerts beside Needs
// attention, Recent runs beside the heartbeat, the heartbeat beside the
// workspace cards), each block added on top of the last. mission-control.tsx
// holds the pieces, which the workspace page shares.

import { viewerScope } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces, listAllRuns } from "@/lib/store";
import { platform } from "@/lib/platform";
import { workspaceBudgetStanding } from "@/platform/limits";
import { walletNotice } from "@/server/billing-notices";
import { upcomingRuns } from "@/platform/scheduler";
import { avatarUrl } from "@/platform/avatars";
import { CreateForm } from "@/components/create";
import { DemoButton } from "./demo-button";
import { alertsFor, nowMs } from "@/components/overview-model";
import { AttentionPanel, Cells, NowNext, SpendPanel, outcomeRing } from "@/components/mission-control";
import { deskRows } from "@/components/desks-model";
import { needsList, heartbeats, nowBoard, spendWithin, fmtSpan, DAY_MS } from "@/components/mission-model";
import { accountIssues } from "@/server/issues";
import { runLite } from "@/server/run-lite";
import { runCharges } from "@/server/run-charges";
import { AutoRefresh } from "./run-button";
import { ImportPackageButton } from "@/components/package-buttons";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { onboardingFor, ONBOARDING_PREF } from "@/server/onboarding";
import { OnboardingCard, OnboardingReopen } from "@/components/onboarding-card";
import Link from "next/link";
import { Boxes, CircleDashed, Clock3, Plus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { OUTCOME } from "@/components/outcome-model";
import { fmtIn } from "@/components/workspace-overview-model";
import { creditsShort } from "@/components/money";
import { Page, ResourceCard, EmptyState } from "@/components/kit/page";
import { SplitOverview } from "@/components/kit/overview";
import { Status, StatusDot } from "@/components/kit/status";
import { buttonVariants } from "@/components/kit/button";
import type { Row } from "@/components/kit/list";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; create?: string; import?: string }>;
}) {
  const { tenant = "default", create, import: importing } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const now = nowMs();

  // A member scoped to some workspaces sees only those, here as everywhere.
  const scope = await viewerScope();
  const workspaces = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name));
  const runs = listAllRuns(tenant).filter((r) => scopeAllows(scope, r.workspace));
  // The balance and its alert are billing's to word (billing-notices.ts);
  // without billing there are none.
  const wallet = platform.edition() === "hosted" ? await walletNotice(tenant, tenant !== "default" ? `tenant=${tenant}` : "") : null;

  const nearCap: { workspace: string; spent: number; budget: number; label: string }[] = [];
  for (const w of workspaces) {
    const standing = await workspaceBudgetStanding(tenant, w.name);
    if (!standing.budget) continue;
    if (standing.spentUsd >= standing.budget.usd * 0.8) {
      nearCap.push({ workspace: w.name, spent: standing.spentUsd, budget: standing.budget.usd, label: standing.label! });
    }
  }
  // Money only: approvals and failures are listed run by run above them.
  const money = alertsFor({
    wallet: wallet?.alert ?? null,
    nearCap,
    qs: tenant !== "default" ? `tenant=${tenant}` : "",
  });

  // Every run reduced once, read four ways.
  const charges = await runCharges(tenant);
  const lite = runs.map((r) => runLite(r, charges));
  const board = nowBoard(lite, now);
  // Waiting and stuck from the runs; failures, BLOCKED, BAD and platform
  // causes as issues, open until a person resolves them (FOL-54 step 3).
  const needs = needsList(lite, await accountIssues(tenant, scope, now, lite), now);
  const beats = heartbeats(workspaces.map((w) => w.name), lite, now, 20);
  const upcoming = upcomingRuns(tenant, 500).filter((u) => scopeAllows(scope, u.workspace));
  const desks = deskRows(
    workspaces.map((w) => ({ ...w, avatar: avatarUrl(tenant, "workspace", w.name) ?? undefined })),
    beats,
    upcoming,
  );
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  // Getting started: derived from the account, hidden per person.
  const onboarding = await onboardingFor(tenant, scope);
  const person = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const onboardingHidden = Boolean(person?.prefs?.[ONBOARDING_PREF]);

  const spendHref = `/dashboard/usage${qs}`;
  const rows: Row[] = desks.map((d) => {
    const last = d.beat.last;
    const ring = outcomeRing(last?.outcome);
    const href = `/dashboard/${d.name}${qs}`;
    const mark = <Avatar name={d.name} src={d.avatar ?? null} size="lg" square />;
    const lastLine = last ? (
      <>
        <StatusDot outcome={last.outcome} label="" />
        <span className="truncate">
          {last.what} · {OUTCOME[last.outcome].label} {fmtSpan(now - Date.parse(last.startedAt))} ago
        </span>
      </>
    ) : (
      <>
        <CircleDashed />
        <span className="truncate">No runs yet</span>
      </>
    );
    const nextLine = d.next ? (
      <>
        <Clock3 />
        <span className="truncate">
          {d.next.flow} {fmtIn(Math.max(0, Date.parse(d.next.at) - now))}
        </span>
      </>
    ) : null;
    return {
      key: d.name,
      search: [d.name, d.description, last?.what, last?.headline, d.next?.flow].filter(Boolean).join(" "),
      href,
      icon: <Avatar name={d.name} src={d.avatar ?? null} size="sm" square />,
      name: d.name,
      sub: d.description || `${d.agents} agents · ${d.flows} flows`,
      cells: {
        status: <Status outcome={last?.outcome ?? "quiet"} label={last ? undefined : "No runs"} />,
        runs: <Cells beat={d.beat} n={12} tenant={tenant} />,
        next: d.next ? `${d.next.flow} ${fmtIn(Math.max(0, Date.parse(d.next.at) - now))}` : undefined,
        spend: creditsShort(d.beat.spend7dUsd),
      },
      card: (
        <ResourceCard
          href={href}
          mark={mark}
          name={d.name}
          sub={`${d.agents} agent${d.agents === 1 ? "" : "s"} · ${d.flows} flow${d.flows === 1 ? "" : "s"}`}
          status={d.beat.live ? "busy" : ring}
          statusLabel={d.beat.live ? `${d.beat.live} running` : last ? OUTCOME[last.outcome].hint : "no runs yet"}
          lines={[lastLine, ...(nextLine ? [nextLine] : [])]}
        />
      ),
    };
  });

  return (
    <Page>
      {/* The create dialog has no button of its own on this page — Create
          new and the workspace switcher open it through ?create=workspace. */}
      <CreateForm
        noun="workspace"
        placeholder="marketing"
        hint="Its own agents, flows, secrets and runs. Starts blank: import agents from another workspace, or create them."
        tenant={tenant}
        options={[{ where: "account", label: "Account", target: { endpoint: "/api/workspaces", body: { template: true, ifAbsent: true } } }]}
        trigger={false}
        autoOpen={create === "workspace"}
      />
      {/* Same idea for a package: Create new → Import workspace opens it through ?import=workspace. */}
      {importing === "workspace" && (
        <div className="hidden">
          <ImportPackageButton tenant={tenant} newWorkspace autoOpen />
        </div>
      )}
      {/* Live rows repaint themselves; the timer is for the board around them. */}
      <AutoRefresh active={board.length > 0} />
      <h1 className="sr-only">Workspaces</h1>
      {!onboardingHidden && !onboarding.complete && (
        <div className="mb-6">
          <OnboardingCard data={onboarding} qs={qs} canDismiss={Boolean(person)} />
        </div>
      )}
      <SplitOverview
        search="Search workspaces…"
        title="Workspaces"
        actions={
          <Link href={`/dashboard?create=workspace${rest}`} className={buttonVariants({ variant: "secondary" })}>
            <Plus aria-hidden />
            New workspace
          </Link>
        }
        columns={[
          { key: "status", header: "Last run" },
          { key: "runs", header: "Recent runs", hide: "lg" },
          { key: "next", header: "Next", hide: "md" },
          { key: "spend", header: "7 days", align: "end", hide: "sm" },
        ]}
        rows={rows}
        empty={
          <EmptyState
            icon={<Boxes />}
            title="No workspaces yet"
            description="A workspace holds its own agents, flows, secrets and runs. Start with the demo: a four-step pipeline you can run in a minute."
            action={
              <>
                <DemoButton tenant={tenant} exists={false} />
                <Link href={`/dashboard?create=workspace${rest}`} className={buttonVariants({ variant: "secondary" })}>
                  New workspace
                </Link>
              </>
            }
          />
        }
        left={
          <>
            <SpendPanel
              dayUsd={spendWithin(lite, now, DAY_MS)}
              weekUsd={spendWithin(lite, now, 7 * DAY_MS)}
              balanceUsd={wallet?.balanceUsd ?? null}
              href={spendHref}
              balanceHref={`/dashboard/billing${qs}`}
            />
            <AttentionPanel items={needs} alerts={money} tenant={tenant} issuesHref={`/dashboard/issues${qs}`} accountWide={scope === null} />
            <NowNext board={board} upcoming={upcoming} now={now} tenant={tenant} runsHref={`/dashboard/runs?status=running${rest}`} />
          </>
        }
      />
      {onboardingHidden && !onboarding.complete && (
        <div className="mt-8">
          <OnboardingReopen done={onboarding.done} total={onboarding.total} />
        </div>
      )}
    </Page>
  );
}
