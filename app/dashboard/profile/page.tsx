// Profile: you, on this install — your picture, your clock, your password,
// where you are signed in, what mail you get — and the team you share the account with. On the
// settings shell like every other settings page.

import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession, listMembers, allowedWorkspaces, SESSION_COOKIE } from "@/server/users";
import { listWorkspaces } from "@/lib/store";
import { scopeAllows, describeScope } from "@/platform/scope";
import { Card, PageHeader } from "@/components/ui";
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
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant = "default" } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  if (!session) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Profile" subtitle="Who you are on this install." />
        <Card className="p-5">
          <p className="text-sm text-fg-tertiary">
            No one is signed in — this install is running with authentication off (<code className="font-mono text-xs">FOLDRUN_DEV_NO_AUTH=1</code>), so there is
            no profile to show. Account keys and secrets are on{" "}
            <Link href={`/dashboard/settings${qs}`} className="font-medium text-fg hover:underline">Settings</Link>.
          </p>
        </Card>
      </main>
    );
  }

  if (tenant !== "default" && tenant !== session.tenant) notFound();
  const members = (await listMembers(session.tenant)).map((m) => ({ ...m, avatar: avatarUrl(session.tenant, "user", m.id) }));
  const scope = await allowedWorkspaces(session.tenant, session.id);
  const workspaces = listWorkspaces(session.tenant).map((w) => w.name).filter((w) => scopeAllows(scope, w));
  const me = members.find((m) => m.id === session.id);

  const nav = [
    { id: "you", label: "You" },
    { id: "name", label: "Name" },
    { id: "email", label: "Email" },
    { id: "timezone", label: "Timezone" },
    { id: "appearance", label: "Appearance" },
    { id: "password", label: "Password" },
    { id: "mfa", label: "Two-factor" },
    { id: "sessions", label: "Sessions" },
    { id: "notifications", label: "Notifications" },
    { id: "team", label: "Team" },
  ];

  return (
    <main>
      <SettingsShell nav={nav} title="Profile" subtitle="You, on this install — and who shares the account.">
        <SettingsSection id="you" title="You" description="Your picture is shown wherever you are named: the top bar, the team, a run you approved.">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex flex-wrap items-center gap-6">
              <AvatarEditor kind="user" id={session.id} name={session.email} src={avatarUrl(session.tenant, "user", session.id)} tenant={session.tenant} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg"><Email value={session.email} /></p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {me?.owner ? "Owner" : (me?.role ?? "member")} of <span className="font-mono text-fg-secondary">{session.tenant}</span> · {me?.owner ? "all workspaces" : describeScope(me?.workspaces ?? null)} · joined <LocalTime iso={session.createdAt} />
                </p>
              </div>
            </div>
            <SignOutButton />
          </Card>
        </SettingsSection>

        <SettingsSection id="name" title="Name" description="How you are addressed in mail and shown to your team. Optional — without it you are shown by email.">
          <Card className="p-5">
            <NameForm firstName={session.firstName ?? null} lastName={session.lastName ?? null} />
          </Card>
        </SettingsSection>

        <SettingsSection id="email" title="Email" description="Your login. Changing it asks for your password, sends a confirmation to the new address, and tells the old one.">
          <Card className="p-5">
            <EmailForm current={session.email} />
          </Card>
        </SettingsSection>

        <SettingsSection id="timezone" title="Timezone" description="How you read timestamps — every run time, every date, everywhere. A schedule fires on its own timezone:, not yours.">
          <Card className="p-5">
            <TimezoneForm current={session.timezone ?? null} />
          </Card>
        </SettingsSection>

        <SettingsSection id="appearance" title="Appearance" description="Light, dark, or the same as your computer. Yours alone, on every browser you sign in on.">
          <Card className="p-5">
            <AppearanceForm current={themePreference(session.prefs)} />
          </Card>
        </SettingsSection>

        <SettingsSection id="password" title="Password" description="Changing it does not end sessions on other devices; end those below.">
          <Card className="p-5">
            <PasswordForm />
          </Card>
        </SettingsSection>

        <SettingsSection id="mfa" title="Two-factor authentication" description="A code from an authenticator app at every sign-in. The one thing that makes a leaked password not enough.">
          <Card className="p-5">
            <MfaSection enabled={!!session.mfaEnabledAt} />
          </Card>
        </SettingsSection>

        <SettingsSection wide id="sessions" title="Signed in on" description="Every device holding a session for you. End one and it is signed out at once.">
          <Card className="p-5">
            <SessionList />
          </Card>
        </SettingsSection>

        <SettingsSection wide id="notifications" title="Notifications" description="What mail you get. Run alerts and approval requests can be set per workspace; security, invites, billing failures and account notices are always sent.">
          <NotificationPreferences workspaces={workspaces} />
        </SettingsSection>

        <SettingsSection
          id="team" wide
          title="Team"
          description="Who shares this account, what each may do, and which workspaces each may open. Everyone shares one wallet and one shelf of shared tools."
          action={<span className="text-xs text-fg-subtle">{members.length}</span>}
        >
          <TeamManager members={members} self={session.email} workspaces={workspaces} />
        </SettingsSection>
      </SettingsShell>
    </main>
  );
}
