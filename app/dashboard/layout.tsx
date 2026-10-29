// The shell for every dashboard page: Inter for everything, a mono for
// code (both from the root layout), a light ground, a deeper sidebar.
// The marketing page at / keeps its own look.

import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { PendingApprovals } from "@/components/pending-approvals";
import { UserMenu } from "@/components/user-menu";
import { ViewerTimeZoneProvider } from "@/components/viewer-time";
import { RoleProvider } from "@/components/role";
import { verifySession, SESSION_COOKIE, roleOfUser } from "@/server/users";
import { TopBar } from "@/components/topbar";
import { InboxLink } from "@/components/inbox-link";
import { BalancePill, LowBalanceBanner, DunningBanner, SupportBanner } from "@/components/billing-slots";
import { Find } from "@/components/find";
import { WithEmails } from "@/components/email";
import { MobileNav } from "@/components/mobile-nav";
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
    <div
      className="flex min-h-screen bg-paper font-sans text-fg antialiased"
    >
      <Suspense>
        <Sidebar />
      </Suspense>
      {/* overflow-x-clip: the page body must never scroll sideways; anything
          that pokes past the pane is clipped, not scrolled to. */}
      {/* pb-20: room under every page for the Ask AI button, so it never
          sits on the last row. */}
      <div className="min-w-0 flex-1 overflow-x-clip pb-20">
        {/* One slim bar over every page: the person, top right. Account-level
            pages (usage, wallet, help, settings, sign out) live behind the
            avatar, the way every SaaS keeps who-you-are out of the work nav —
            the sidebar below stays about the workspace alone. */}
        <div className="sticky top-0 z-40 flex h-12 items-center justify-between gap-3 border-b border-line/80 bg-paper/90 px-4 backdrop-blur">
          {/* Where you are, top left: account / workspace, each a switcher with a
              find box. Who you are stays top right. */}
          <div className="flex min-w-0 items-center">
            <Suspense>
              <MobileNav />
            </Suspense>
            <Suspense>
              <TopBar account={tenant} plan={plan} workspaces={[]} accountAvatar={avatarUrl(tenant, "account", tenant)} />
            </Suspense>
          </div>
          <div className="flex items-center gap-2">
            {/* The balance beside the person: money is account-level, and the
                number should never need a click to discover. */}
            {/* What is waiting on you, with what you have not read. */}
            <Suspense>
              <InboxLink tenant={tenant} />
            </Suspense>
            <Suspense>
              <BalancePill tenant={tenant} />
            </Suspense>
            <Suspense>
              <UserMenu />
            </Suspense>
          </div>
        </div>
        {/* An incident or maintenance the operator posted: on every page
            while it is live, gone when it is resolved. */}
        <StatusBanner statusPage={statusPageUrl()} />
        {/* When the balance is about to run out, say so on every page, with
            the one button that fixes it. The email for this exists; a
            banner is for the person who is already here. */}
        <Suspense>
          <DunningBanner tenant={tenant} />
        </Suspense>
        <Suspense>
          <LowBalanceBanner tenant={tenant} />
        </Suspense>
        <Suspense>
          <Find />
        </Suspense>
        <Suspense>
          <PendingApprovals />
        </Suspense>
        {session && !session.emailVerifiedAt && edition === "hosted" && (
          <VerifyBanner email={session.email} />
        )}
        {suspended && (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">
            <span className="font-medium">This account is suspended</span> — {suspended.reason}. Runs will not start until it is restored; everything here stays readable. Reply to the email you received, or write to hello@foldrun.io.
          </div>
        )}
        {accountPaused && (
          <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800">
            <span className="flex-1">
              <span className="font-medium">Runs are paused</span> — nothing new starts in any workspace.{" "}
              <WithEmails text={`Paused by ${accountPaused.by}${accountPaused.reason ? `: ${accountPaused.reason}` : ""}.`} />
            </span>
            <Link href="/dashboard/settings#governance" className="text-xs font-semibold underline">
              Resume
            </Link>
          </div>
        )}
        {noModelKey && (
          <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
            <span className="flex-1">
              <span className="font-medium">No model key</span> — runs on this account are refused until you add an API key from your model provider.
              {!can(role, "secrets:write") && <span className="ml-2 opacity-80">Only an admin can add it — ask one.</span>}
            </span>
            {can(role, "secrets:write") && (
              <Link href="/dashboard/settings#provider" className="text-xs font-semibold underline">
                Add a key
              </Link>
            )}
          </div>
        )}
        {children}
      </div>
      <UpdateToast />
      {/* The assistant, on every page: inside a workspace it works there,
          elsewhere in the one picked in its header. */}
      <AssistantDock tenant={tenant} />
    </div>
    </ViewerTimeZoneProvider>
    </RoleProvider>
    </EditionProvider>
    </VersionProvider>
  );
}
