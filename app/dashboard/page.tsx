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
import { AttentionPanel, NowNext, StatusStrip } from "@/components/mission-control";
import { DesksTable } from "@/components/desks-table";
import { deskRows } from "@/components/desks-model";
import { needsList, heartbeats, nowBoard, spendWithin, DAY_MS } from "@/components/mission-model";
import { accountIssues } from "@/server/issues";
import { runLite } from "@/server/run-lite";
import { runCharges } from "@/server/run-charges";
import { AutoRefresh } from "./run-button";
import { ImportPackageButton } from "@/components/package-buttons";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { onboardingFor, ONBOARDING_PREF } from "@/server/onboarding";
import { OnboardingCard, OnboardingReopen } from "@/components/onboarding-card";

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
  const onboarding = await onboardingFor(tenant);
  const person = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const onboardingHidden = Boolean(person?.prefs?.[ONBOARDING_PREF]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      {/* The create dialog has no button of its own on this page — Add New
          and the workspace switcher open it through ?create=workspace. */}
      <CreateForm
        noun="workspace"
        placeholder="marketing"
        hint="Its own agents, flows, secrets and runs. Starts blank: import agents from another workspace, or create them."
        tenant={tenant}
        options={[{ where: "account", label: "Account", target: { endpoint: "/api/workspaces", body: { template: true, ifAbsent: true } } }]}
        trigger={false}
        autoOpen={create === "workspace"}
      />
      {/* Same idea for a package: Add New → Import workspace opens it through ?import=workspace. */}
      {importing === "workspace" && (
        <div className="hidden">
          <ImportPackageButton tenant={tenant} newWorkspace autoOpen />
        </div>
      )}
      {/* Live rows repaint themselves; the timer is for the board around them. */}
      <AutoRefresh active={board.length > 0} />
      <StatusStrip
        now={now}
        facts={{
          running: board.length,
          attention: needs.length + money.length,
          platform: needs.filter((a) => a.kind === "platform").length,
          next: upcoming[0] ? { flow: upcoming[0].flow, at: upcoming[0].at, workspace: upcoming[0].workspace } : null,
          spendDayUsd: spendWithin(lite, now, DAY_MS),
          spend7dUsd: spendWithin(lite, now, 7 * DAY_MS),
          balanceUsd: wallet?.balanceUsd ?? null,
          links: {
            attention: needs.length + money.length ? "#attention" : `/dashboard/runs${qs}`,
            running: `/dashboard/runs?status=running${rest}`,
            next: `/dashboard/settings${qs}#schedules`,
            spend: `/dashboard/usage${qs}`,
            balance: `/dashboard/billing${qs}`,
          },
        }}
      />
      {!onboardingHidden && <OnboardingCard data={onboarding} qs={qs} canDismiss={Boolean(person)} />}
      <AttentionPanel items={needs} alerts={money} tenant={tenant} issuesHref={`/dashboard/issues${qs}`} accountWide={scope === null} />
      <NowNext board={board} upcoming={upcoming} now={now} tenant={tenant} runsHref={`/dashboard/runs?status=running${rest}`} />
      <DesksTable rows={desks} tenant={tenant} now={now} />
      {workspaces.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-line p-4 text-center">
          <p className="mb-2 text-xs text-fg-muted">New here? A four-step pipeline you can run in a minute.</p>
          <DemoButton tenant={tenant} exists={false} />
        </div>
      )}
      {onboardingHidden && !onboarding.complete && <OnboardingReopen done={onboarding.done} total={onboarding.total} />}
    </main>
  );
}
