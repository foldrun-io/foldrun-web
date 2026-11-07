// The shell for every dashboard page (UI refactor, Nov 2026): Vercel's
// shape. The sidebar on the left (nav-model.ts), one bar over the content —
// where you are on the left (account / workspace), New, the inbox, money and
// the person on the right — then the notices, then the page. Phones get a
// drawer and a floating bar at the bottom. Geist for everything, Geist Mono
// for code (both from the root layout).

import { Suspense } from "react";
import Link from "@/components/kit/link";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { PendingApprovals } from "@/components/pending-approvals";
import { ViewerTimeZoneProvider } from "@/components/viewer-time";
import { RoleProvider } from "@/components/role";
import { verifySession, SESSION_COOKIE, roleOfUser } from "@/server/users";
import { ShellDataProvider } from "@/components/topbar";
import { BalancePill, LowBalanceBanner, DunningBanner, SupportBanner } from "@/components/billing-slots";
import { Find } from "@/components/find";
import { WithEmails } from "@/components/email";
import { PhoneBar, PhoneHeader, ShellBar, StatusFooter } from "@/components/mobile-nav";
import { NewMenu } from "@/components/new-menu";
import { Banner } from "@/components/kit/page";
import { TooltipProvider } from "@/components/kit/tooltip";
import { platform } from "@/lib/platform";
import { EditionProvider } from "@/components/edition";
import { adminState } from "@/platform/admin";
import { billing } from "@/platform/billing";
import { VerifyBanner } from "@/components/verify-banner";
import { avatarUrl } from "@/platform/avatars";
import { VersionProvider, UpdateToast } from "@/components/version";
import { versionInfo } from "@/server/release";
import { StatusBanner } from "@/components/status-banner";
import { statusPageUrl } from "@/server/status";
import { AssistantDock } from "@/components/assistant";
import { accountModelSupply } from "@/server/account-model";
import { can } from "@/platform/permissions";


export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Read once, here, for every page below: the zone this person chose, or null
  // for automatic. Mounting the provider at the layout is what makes it one
  // clock per session rather than a per-component guess.
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  // The same table the API refuses with, so the dashboard draws only the
  // controls this person may use — a Run button that always 403s teaches
  // people the product is broken rather than that they lack the permission.
  // No session (dev mode) is treated as the owner, which is what it always was.
  const role = session ? ((await roleOfUser(session.tenant, session.id)) ?? "viewer") : "owner";
  // The switchers at the top left take the session's account as a first
  // paint and ask the API for the rest on every navigation — listing every
  // workspace's agents and flows here cost every page a walk of the disk.
  const tenant = session?.tenant ?? "default";
  // A plan is a hosted concept. The community dashboard has no plan badge
  // to show because there is nothing it could say — nobody is metering.
  const edition = platform.edition();
  // A suspended account still signs in — that is the point: the notice has
  // to be readable by the person it is about. Runs are refused (423) with
  // the same reason; this is the same sentence, where they will see it.
  const suspended = edition === "hosted" ? (await adminState(tenant)).suspended : undefined;
  // The account's own kill switch, on every page while it holds: a person
  // who opens the dashboard to find nothing running is told why at once.
  // Every edition — pausing is not a hosted feature.
  const accountPause = (await adminState(tenant)).paused?.account;
  const accountPaused = accountPause && !accountPause.resumedAt ? accountPause : null;
  // "Metered" only when billing is enforced: a hosted install with billing
  // off (dev, staging) meters nothing, and the badge said otherwise (FOL-28).
  const plan = edition === "hosted" ? (billing().enabled() ? "Metered" : "Free") : null;
  // An account with no model key has every run refused (FOL-15). Said on
  // every page until it has one, and not dismissable: nothing else works.
  const noModelKey = accountModelSupply(tenant) === "none";

  // The version this page was rendered with: the sidebar shows it, and the
  // update notice compares /api/version against it.
  const version = versionInfo().version;

  return (
    <VersionProvider version={version}>
    <EditionProvider edition={edition}>
    <RoleProvider role={role}>
    <ViewerTimeZoneProvider timezone={session?.timezone ?? null}>
    {session?.viewAs && <SupportBanner account={tenant} expiresAt={session.viewAs.expiresAt} reason={session.viewAs.reason} />}
    <TooltipProvider delayDuration={250}>
    <ShellDataProvider account={tenant} plan={plan} accountAvatar={avatarUrl(tenant, "account", tenant)}>
    <div className="flex min-h-svh bg-paper font-sans text-fg antialiased">
      <Suspense>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>
          <PhoneHeader />
        </Suspense>
        <Suspense>
          <ShellBar
            actions={
              <>
                <Suspense>
                  <NewMenu />
                </Suspense>
                <Suspense>
                  <BalancePill tenant={tenant} />
                </Suspense>
              </>
            }
          />
        </Suspense>
        {/* Notices, most important first (agreed in the refactor's design
            review): who you are acting as, then what stops every run
            (suspended, paused, a live incident, no model key), then money,
            then the email check. */}
        {suspended && (
          <Banner tone="danger" title="This account is suspended">
            {suspended.reason}. Runs will not start until it is restored; everything here stays readable. Reply to the email you received, or write to hello@foldrun.io.
          </Banner>
        )}
        {accountPaused && (
          <Banner tone="danger" title="Runs are paused" action={<Link href="/dashboard/settings#governance">Resume</Link>}>
            Nothing new starts in any workspace. <WithEmails text={`Paused by ${accountPaused.by}${accountPaused.reason ? `: ${accountPaused.reason}` : ""}.`} />
          </Banner>
        )}
        {/* An incident or maintenance the operator posted: on every page
            while it is live, gone when it is resolved. */}
        <StatusBanner statusPage={statusPageUrl()} />
        {noModelKey && (
          <Banner tone="warning" title="No model key" action={can(role, "secrets:write") ? <Link href="/dashboard/settings#provider">Add a key</Link> : undefined}>
            Runs on this account are refused until you add an API key from your model provider.
            {!can(role, "secrets:write") && <span className="ml-1 opacity-80">Only an admin can add it — ask one.</span>}
          </Banner>
        )}
        <Suspense>
          <DunningBanner tenant={tenant} />
        </Suspense>
        <Suspense>
          <LowBalanceBanner tenant={tenant} />
        </Suspense>
        {session && !session.emailVerifiedAt && edition === "hosted" && <VerifyBanner email={session.email} />}
        <Suspense>
          <Find />
        </Suspense>
        <Suspense>
          <PendingApprovals />
        </Suspense>
        {/* overflow-x-clip: the page body must never scroll sideways. */}
        <main id="main" className="min-w-0 flex-1 overflow-x-clip pb-28 md:pb-16">{children}</main>
        <Suspense>
          <StatusFooter statusPage={edition === "hosted" ? statusPageUrl() : null} />
        </Suspense>
      </div>
      <Suspense>
        <PhoneBar />
      </Suspense>
      <UpdateToast />
      {/* The assistant, on every page: inside a workspace it works there,
          elsewhere in the one picked in its header. */}
      <AssistantDock tenant={tenant} />
    </div>
    </ShellDataProvider>
    </TooltipProvider>
    </ViewerTimeZoneProvider>
    </RoleProvider>
    </EditionProvider>
    </VersionProvider>
  );
}
