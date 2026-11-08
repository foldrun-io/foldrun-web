// Profile: you, on this install — your picture, your clock, your password,
// where you are signed in, what mail you get — and the team you share the account with. On the
// settings shell like every other settings page.

import { cookies } from "next/headers";
import Link from "@foldrun/ui/react/link";
import { notFound } from "next/navigation";
import { verifySession, listMembers, allowedWorkspaces, SESSION_COOKIE } from "@/server/users";
import { listWorkspaces } from "@/lib/store";
import { scopeAllows, describeScope } from "@/platform/scope";
import { SettingsCard, EmptyState } from "@foldrun/ui/react/page";
import { UserRound } from "lucide-react";
import { HashTab } from "../settings/anchor";
import { LocalTime } from "@/components/local-time";
import { SettingsShell, SettingsSection } from "@/components/settings-shell";
import { SignOutButton } from "../settings/session";
import { TeamManager } from "../settings/team";
import { AvatarEditor } from "@/components/avatar";
import { avatarUrl } from "@/platform/avatars";
import { PasswordForm } from "./password";
import { MfaSection } from "./mfa";
import { TimezoneForm } from "./timezone";
import { AppearanceForm } from "./appearance";
import { themePreference } from "@/components/theme-model";
import { NameForm, EmailForm } from "./identity";
import { SessionList } from "./sessions";
import { NotificationPreferences } from "./notifications";
import { Email } from "@/components/email";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; tab?: string }>;
}) {
  const { tenant = "default", tab: tabParam } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  if (!session) {
    return (
      <SettingsShell title="Profile" subtitle="Who you are on this install.">
        <EmptyState
          icon={<UserRound />}
          title="No one is signed in"
          description={
            <>
              This install is running with authentication off (<code className="font-mono text-xs">FOLDRUN_DEV_NO_AUTH=1</code>), so there is no profile to show. Account keys and secrets are on{" "}
              <Link href={`/dashboard/settings${qs}`} className="font-medium text-link hover:underline">
                Settings
              </Link>
              .
            </>
          }
        />
      </SettingsShell>
    );
  }

  if (tenant !== "default" && tenant !== session.tenant) notFound();
  const members = (await listMembers(session.tenant)).map((m) => ({ ...m, avatar: avatarUrl(session.tenant, "user", m.id) }));
  const scope = await allowedWorkspaces(session.tenant, session.id);
  const workspaces = listWorkspaces(session.tenant).map((w) => w.name).filter((w) => scopeAllows(scope, w));
  const me = members.find((m) => m.id === session.id);

  const TABS = ["general", "security", "notifications", "team"] as const;
  type Tab = (typeof TABS)[number];
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "general";
  const base = "/dashboard/profile";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const href = (t: Tab) => (t === "general" ? `${base}${qs}` : `${base}?tab=${t}${amp}`);
  // Old one-column anchors, each now on a tab (an unsubscribe page, a bookmark).
  const SECTIONS: Record<string, Tab> = { you: "general", name: "general", email: "general", timezone: "general", appearance: "general", password: "security", mfa: "security", sessions: "security", notifications: "notifications", team: "team" };

  return (
    <SettingsShell
      title="Profile"
      subtitle="You, on this install — and who shares the account."
      actions={<SignOutButton />}
      tabs={[
        { label: "General", href: href("general"), active: tab === "general" },
        { label: "Security", href: href("security"), active: tab === "security" },
        { label: "Notifications", href: href("notifications"), active: tab === "notifications" },
        { label: "Team", href: href("team"), active: tab === "team", badge: members.length },
      ]}
    >
      <HashTab sections={SECTIONS} current={tab} base={`${base}${qs}`} defaultTab="general" />
      {tab === "general" && (
        <>
          <SettingsCard id="you" title="You" description="Your picture is shown wherever you are named: the top bar, the team, a run you approved.">
            <div className="flex flex-wrap items-center gap-6">
              <AvatarEditor kind="user" id={session.id} name={session.email} src={avatarUrl(session.tenant, "user", session.id)} tenant={session.tenant} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">
                  <Email value={session.email} />
                </p>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {me?.owner ? "Owner" : (me?.role ?? "member")} of <span className="font-mono text-fg-secondary">{session.tenant}</span> · {me?.owner ? "all workspaces" : describeScope(me?.workspaces ?? null)} · joined{" "}
                  <LocalTime iso={session.createdAt} />
                </p>
              </div>
            </div>
          </SettingsCard>
          <SettingsCard id="name" title="Name" description="How you are addressed in mail and shown to your team. Optional — without it you are shown by email.">
            <NameForm firstName={session.firstName ?? null} lastName={session.lastName ?? null} />
          </SettingsCard>
          <SettingsCard id="email" title="Email" description="Your login. Changing it asks for your password, sends a confirmation to the new address, and tells the old one.">
            <EmailForm current={session.email} />
          </SettingsCard>
          <SettingsCard id="timezone" title="Timezone" description="How you read timestamps — every run time, every date, everywhere. A schedule fires on its own timezone:, not yours.">
            <TimezoneForm current={session.timezone ?? null} />
          </SettingsCard>
          <SettingsCard id="appearance" title="Appearance" description="Light, dark, or the same as your computer. Yours alone, on every browser you sign in on.">
            <AppearanceForm current={themePreference(session.prefs)} />
          </SettingsCard>
        </>
      )}

      {tab === "security" && (
        <>
          <SettingsCard id="password" title="Password" description="Changing it does not end sessions on other devices; end those below.">
            <PasswordForm />
          </SettingsCard>
          <SettingsCard id="mfa" title="Two-factor authentication" description="A code from an authenticator app at every sign-in. The one thing that makes a leaked password not enough.">
            <MfaSection enabled={!!session.mfaEnabledAt} />
          </SettingsCard>
          <SettingsCard id="sessions" title="Signed in on" description="Every device holding a session for you. End one and it is signed out at once.">
            <SessionList />
          </SettingsCard>
        </>
      )}

      {tab === "notifications" && (
        <SettingsSection
          id="notifications"
          title="Notifications"
          description="What mail you get. Run alerts and approval requests can be set per workspace; security, invites, billing failures and account notices are always sent."
        >
          <NotificationPreferences workspaces={workspaces} />
        </SettingsSection>
      )}

      {tab === "team" && (
        <SettingsSection id="team" title="Team" description="Who shares this account, what each may do, and which workspaces each may open. Everyone shares one wallet and one shelf of shared tools.">
          <TeamManager members={members} self={session.email} workspaces={workspaces} />
        </SettingsSection>
      )}
    </SettingsShell>
  );
}
