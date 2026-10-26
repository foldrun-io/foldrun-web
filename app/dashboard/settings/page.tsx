import { scopeAllows } from "@/platform/scope";
import { platform } from "@/lib/platform";
import Link from "next/link";
import { ScheduleInYourTime } from "./schedule-in-your-time";
import { cookies } from "next/headers";
import { listApiKeys } from "@/server/auth";
import { can } from "@/platform/permissions";
import { verifySession, listMembers, SESSION_COOKIE, viewerScope, viewerRole } from "@/server/users";
import { PauseCard } from "@/components/pause-card";
import { TelemetryCard } from "@/components/telemetry-card";
import { pauseView } from "@/server/pause";
import { TeamManager } from "./team";
import { accountDir, parseProvider } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsOf } from "@/components/defaults-model";
import { TimezoneCard, NotifyCard, ConcurrencyCard, ComputeCard, DeployBlockCard, NetworkEnforceCard, OwnerCard, AlertsCard, JudgeCard } from "@/components/defaults-cards";
import { accountCompute, computeInUse, roomWaiting } from "@/platform/limits";
import { billing } from "@/platform/billing";
import { AvatarEditor } from "@/components/avatar";
import { avatarUrl } from "@/platform/avatars";
import { listWorkspaces, listFlows } from "@/lib/store";
import { parseCron, cronMatches } from "@/platform/scheduler";
import { Badge, Card, buttonClass } from "@/components/ui";
import { SettingsShell, SettingsSection, StatusRow } from "@/components/settings-shell";
import { KeyManager, TickButton } from "./keys";
import { listSecrets } from "@/lib/secrets";
import { secretHealth, healthKey } from "@/lib/secret-health";
import { masterKeySource } from "@/lib/secrets";
import { webhookPath, readDeliveries } from "@/lib/webhook";
import { RotateHookButton } from "./rotate-hook";
import { connectionStatus } from "@/platform/oauth-connections";
import { Connections } from "./connections";
import { listOAuthClients } from "@/platform/oauth-clients";
import { LocalTime } from "@/components/local-time";
import { AccountData } from "./close-account";
import { adminState } from "@/platform/admin";
import { versionInfo } from "@/server/release";
import { VersionFacts, ComponentTable } from "@/components/version-table";

import { ApiSettings } from "./api-settings";
import { apiFactsFor } from "@/server/api-facts";
import { effectiveFlags } from "@/platform/flags";
import { lastProviderCheck } from "@/platform/watchdog";
import { providersInUse } from "@/lib/provider-health";
import { ModelKey } from "./model-key";
import { describeAccountModel, modelPresetChoices } from "@/server/account-model";
import { ProviderCheck } from "./provider-check";
import { Email } from "@/components/email";
import { installOrigin } from "@/server/auth-flows";

export const dynamic = "force-dynamic";

/**
 * The next few fires of a cron, walked once.
 *
 * This used to be two functions that each walked forty days a minute at a
 * time — one for the ISO instant, one for the formatted strings — so every
 * scheduled flow on the page cost two full passes. With eight flows that was
 * tens of seconds of blocked event loop, long enough for a pooled database
 * connection to time out underneath the render and take the page down with
 * it. One walk, both answers.
 */
function nextFires(expr: string, timeZone: string, count = 2): { iso: string | null; local: string[] } {
  const cron = parseCron(expr);
  if (!cron) return { iso: null, local: [] };
  const local: string[] = [];
  let iso: string | null = null;
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  for (let i = 1; i <= 60 * 24 * 40 && local.length < count; i++) {
    const t = new Date(start + i * 60_000);
    // Formatted in the SAME zone the cron was matched in. This said
    // t.toLocaleString() — matching in the flow's timezone and then rendering
    // in the server's, so a flow declared `0 8 * * *` in America/New_York
    // previewed as whatever 8am New York happens to be on the box's clock.
    // A schedule preview should read back the time you typed.
    if (!cronMatches(cron, t, timeZone)) continue;
    if (!iso) iso = t.toISOString();
    local.push(t.toLocaleString("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }));
  }
  return { iso, local };
}

/** Why a flag is what it is, in the words the settings page shows. */
const FLAG_SOURCE: Record<string, string> = {
  account: "set for this account",
  global: "set for every account",
  rollout: "staged rollout",
  default: "default",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; connected?: string; connect_error?: string }>;
}) {
  const { tenant = "default", connected, connect_error } = await searchParams;
  const keys = await listApiKeys(tenant);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  // A member scoped to some workspaces sees only those, here as everywhere:
  // schedules, repositories, hooks and the invite form all list workspaces.
  const scope = await viewerScope();
  // A signing secret and a webhook URL (which carries its token) are what
  // an admin needs to wire a repository or a sender; the API hands them
  // only to workspace:manage (the rotate route), and so does this page.
  // No session — dev mode — is the owner.
  const role = await viewerRole();
  const managesWorkspaces = role === null || can(role, "workspace:manage");
  const halt = await pauseView(tenant, null, scope);
  const visibleWorkspaces = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name));
  const scheduled = visibleWorkspaces.flatMap((p) =>
    listFlows(tenant, p.name)
      .filter((f) => f.trigger === "schedule" && f.schedule)
      .map((f) => ({
        workspace: p.name,
        flow: f.name,
        file: f.file,
        schedule: f.schedule!,
        timezone: f.timezone ?? "UTC",
        valid: parseCron(f.schedule!) !== null,
        ...(() => {
          const fires = nextFires(f.schedule!, f.timezone ?? "UTC");
          return { next: fires.local, nextIso: fires.iso };
        })(),
        zone: f.timezone ?? "UTC",
      })),
  );

  // With each secret's health, as GET /api/secrets answers it: the vault
  // knows a name, only the places that used it know whether it still works.
  const health = await secretHealth(tenant);
  const secrets = listSecrets(tenant).map((s) => ({
    ...s,
    health: health[healthKey(s.name, s.scope === "workspace" ? "workspace" : "account")] ?? null,
  }));

  const hooks = visibleWorkspaces.flatMap((p) => {
    const deliveries = readDeliveries(tenant, p.name, 5);
    return listFlows(tenant, p.name)
      .filter((f) => f.trigger === "webhook")
      .map((f) => ({
        workspace: p.name,
        flow: f.name,
        path: managesWorkspaces ? webhookPath(tenant, p.name, f.name) : null,
        deliveries: deliveries.filter((d) => d.flow === f.name),
      }));
  });

  const authRequired = process.env.FOLDRUN_DEV_NO_AUTH !== "1";
  // Where the key that decrypts every secret on this server is kept.
  const keySource = masterKeySource();

  // Who is signed in (nobody, under dev no-auth) and what the account's
  // credit tank holds.
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);

  const members = session ? (await listMembers(session.tenant)).map((m) => ({ ...m, avatar: avatarUrl(session.tenant, "user", m.id) })) : [];
  const teamWorkspaces = visibleWorkspaces.map((w) => w.name);
  const fm = readAgentsMdKeys(accountDir(tenant));
  const defaults = defaultsOf(fm);
  const provider = parseProvider(fm.provider);
  // The four jobs first (frontmatter-fields.ts JOBS), then the setup pages.
  const JOB = "The four jobs";
  const SETUP = "Setup";
  const nav = [
    { id: "governance", label: "Governance", group: JOB },
    { id: "guardrail", label: "Guardrail", group: JOB },
    { id: "observability", label: "Observability", group: JOB },
    { id: "evaluation", label: "Evaluation", group: JOB },
    { id: "account", label: "Account", group: SETUP },
    ...(session ? [{ id: "team", label: "Team", group: SETUP }] : []),
    { id: "defaults", label: "Defaults", group: SETUP },
    { id: "provider", label: "Model provider", group: SETUP },
    { id: "security", label: "Security", group: SETUP },
    { id: "api-keys", label: "API keys", group: SETUP },
    { id: "api", label: "API", group: SETUP },
    { id: "secrets", label: "Secrets", group: SETUP },
    ...(hooks.length > 0 ? [{ id: "webhooks", label: "Webhooks", group: SETUP }] : []),
    { id: "schedules", label: "Schedules", group: SETUP },
    { id: "about", label: "About", group: SETUP },
    { id: "flags", label: "Feature flags", group: SETUP },
    { id: "backups", label: "Backups", group: SETUP },
    { id: "data", label: "Your data", group: SETUP },
  ];
  const isOwner = role === null || role === "owner";
  // The provider check, as GET /api/account/providers answers it.
  const providerConfigured = providersInUse(tenant).map((p) => ({
    provider: p.spec.name || p.spec.baseUrl,
    declaredIn: p.declaredIn,
    model: p.model,
  }));
  const providerLast = await lastProviderCheck(tenant);
  const apiFacts = await apiFactsFor(tenant);
  const flags = await effectiveFlags(tenant);
  const closeRequestedAt = platform.edition() === "hosted" ? ((await adminState(tenant)).closeRequested?.at ?? null) : null;

  return (
    <main>
      <SettingsShell
        nav={nav}
        title="Settings"
        subtitle={
          <>
            Account <span className="font-mono text-fg-secondary">{tenant}</span> — who you are, keys, secrets, and everything that starts a run without a person.
          </>
        }
        above={
          (connected || connect_error) ? (
            <Card className={`p-4 ${connected ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
              <p className="text-sm font-semibold text-fg">{connected ? "Connected" : "Connect failed"}</p>
              <p className="mt-1 text-sm text-fg-tertiary">
                {connected ? <>The credential landed in the secret <code className="font-mono">{connected}</code>.</> : connect_error}
              </p>
            </Card>
          ) : undefined
        }
      >
        <SettingsSection id="governance" title="Governance" description="Who answers for the agents, what they may spend and run at once, what a deploy refuses, and the switch that stops them. In AGENTS.md: governance: (or the same keys at the top).">
          <div className="grid gap-3">
            <OwnerCard endpoint="/api/account" tenant={tenant} initial={defaults.owner} />
            {/* The plan's number, not the install's alone: until 26 Oct 2026 this read only FOLDRUN_PLAN_CONCURRENCY, so a customer on a plan saw the wrong figure. */}
            <ConcurrencyCard endpoint="/api/account" tenant={tenant} initial={defaults.concurrency} plan={(await billing().plan(tenant))?.concurrency ?? (Number(process.env.FOLDRUN_PLAN_CONCURRENCY) > 0 ? Number(process.env.FOLDRUN_PLAN_CONCURRENCY) : null)} />
            <ComputeCard endpoint="/api/account" tenant={tenant} initial={defaults.compute} pool={await accountCompute(tenant)} inUse={computeInUse(tenant, scope)} waiting={roomWaiting(tenant, scope)} />
            <DeployBlockCard endpoint="/api/account" tenant={tenant} initial={defaults.deployBlock} />
          <PauseCard
            tenant={tenant}
            scope="account"
            own={halt.account}
            mayManage={managesWorkspaces && scope === null}
          />
          {Object.keys(halt.workspaces ?? {}).length > 0 && (
            <p className="mt-2 text-sm text-fg-tertiary">
              Paused on their own: {Object.keys(halt.workspaces ?? {}).join(", ")} — each resumes from its own Settings.
            </p>
          )}
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Also governance: the account budget (Billing), roles and keys (Team, API keys), and each agent&apos;s own owner.</p>
        </SettingsSection>

        <SettingsSection id="guardrail" title="Guardrail" description="What the agents may reach and call, and what stops them mid-run. In AGENTS.md: guardrail: — limits, network and hooks every agent here starts from.">
          <div className="grid gap-3">
            <NetworkEnforceCard endpoint="/api/account" tenant={tenant} initial={defaults.networkEnforce} />
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Each agent&apos;s own limits, network and hooks are on its page; foldrun check --security lists what reaches too far.</p>
        </SettingsSection>

        <SettingsSection id="observability" title="Observability" description="What runs record, and who is told when something crosses a line. In AGENTS.md: observability: — notify, alerts, telemetry, capture.">
          <div className="grid gap-3">
            <NotifyCard endpoint="/api/account" tenant={tenant} initial={defaults.notify} scopeNote="Every workspace inherits this until it sets its own notify:, which replaces it whole." />
            <AlertsCard endpoint="/api/account" tenant={tenant} initial={defaults.alerts} />
            <TelemetryCard tenant={tenant} initial={defaults.telemetry} mayEdit={managesWorkspaces && scope === null} />
          </div>
        </SettingsSection>

        <SettingsSection id="evaluation" title="Evaluation" description="How the agents' work is judged: the model every judge grades with. In AGENTS.md: evaluation: — judge. Each workspace's evals are on its Evals page.">
          <div className="grid gap-3">
            <JudgeCard endpoint="/api/account" tenant={tenant} initial={defaults.judge} />
          </div>
        </SettingsSection>

        <SettingsSection id="account" title="Account" description="Who is signed in, and where the people and money pages are.">
          <Card className="mb-3 p-5">
            <AvatarEditor kind="account" id={tenant} name={tenant} src={avatarUrl(tenant, "account", tenant)} tenant={tenant} />
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-fg">{session?.email ? <Email value={session.email} /> : "No one signed in (dev mode)"}</p>
              <p className="mt-0.5 text-sm text-fg-tertiary">Account <span className="font-mono">{tenant}</span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/dashboard/profile${qs}`} className={buttonClass("secondary")}>Profile &amp; team</Link>
              {platform.edition() === "hosted" && <Link href={`/dashboard/wallet${qs}`} className={buttonClass("secondary")}>Wallet</Link>}
              <Link href={`/dashboard/usage${qs}`} className={buttonClass("secondary")}>Usage</Link>
            </div>
          </Card>
        </SettingsSection>

        {session && (
          <SettingsSection wide id="team" title="Team" description="Who can open this account, and what each person may do. An invite is a link that expires in a week.">
            <TeamManager members={members} self={session.email} workspaces={teamWorkspaces} />
          </SettingsSection>
        )}

        <SettingsSection id="defaults" title="Defaults" description="What every workspace inherits unless it sets its own: the timezone its schedules read in. The four jobs above hold the rest.">
          <div className="grid gap-3">
            <TimezoneCard endpoint="/api/account" tenant={tenant} initial={defaults.timezone} />
          </div>
        </SettingsSection>

        <SettingsSection id="provider" title="Model provider" description="Where model calls go for every workspace that does not name its own provider.">
          <ModelKey tenant={tenant} initial={describeAccountModel(tenant)} presets={modelPresetChoices()} mayEdit={role === null || can(role, "secrets:write")} />
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-sm text-fg">{provider?.baseUrl ?? "Models included"}</code>
              <span className="text-xs text-fg-subtle">{provider?.baseUrl ? "set by the account's AGENTS.md, which wins over the key above" : "no provider: block in the account's AGENTS.md"}</span>
            </div>
            {provider?.models && Object.keys(provider.models).length > 0 && (
              <p className="mt-1.5 font-mono text-xs text-fg-muted">{Object.entries(provider.models).map(([tier, id]) => `${tier} → ${id}`).join(" · ")}</p>
            )}
            <p className="mt-2 text-sm text-fg-tertiary">
              To bring your own gateway, add a <code className="font-mono text-xs">provider:</code> block to the account&apos;s AGENTS.md — the{" "}
              <Link href={`/dashboard/docs/providers${qs}`} className="font-medium text-fg-secondary underline">providers reference</Link> lists the shapes for about thirty vendors.
            </p>
          </Card>
          <ProviderCheck tenant={tenant} configured={providerConfigured} initial={providerLast} mayCheck={role === null || can(role, "run:start")} />
        </SettingsSection>

        <SettingsSection wide id="security" title="Security" description="Two facts about this install that decide whether it is safe to expose.">
          <Card className="divide-y divide-line-faint p-0">
            <StatusRow
              ok={authRequired}
              title={authRequired ? "Every API request needs a key" : "Auth is disabled for local development"}
              detail={
                authRequired
                  ? "The x-foldrun-tenant header alone is rejected."
                  : "FOLDRUN_DEV_NO_AUTH=1 is set, so requests without a key fall back to the x-foldrun-tenant header. Never set it on a server anyone else can reach."
              }
            />
            <StatusRow
              ok={keySource.source === "env"}
              title={keySource.source === "env" ? "The master key comes from the environment" : "The master key is stored on disk"}
              detail={
                keySource.source === "env"
                  ? "FOLDRUN_SECRET_KEY is set, so the key that decrypts every secret is not stored beside the secrets themselves."
                  : <>The key that decrypts every secret sits next to them, so one filesystem read gets both. Before exposing this server, move it: <code className="font-mono">node scripts/rotate-secret-key.mjs {tenant} --to &quot;$(openssl rand -hex 32)&quot;</code>, then set <code className="font-mono">FOLDRUN_SECRET_KEY</code>.</>
              }
            />
          </Card>
          <Card className="mt-3 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-fg">Audit log</p>
              <p className="mt-0.5 text-sm text-fg-tertiary">Sign-ins, keys, invites, secrets by name, deploys, plan changes — and every time support viewed this account.</p>
            </div>
            <Link href={`/dashboard/settings/audit${qs}`} className={buttonClass("secondary")}>Open audit log</Link>
          </Card>
        </SettingsSection>

        {/* KeyManager carries its own title row — the create form sits in it. */}
        <div id="api-keys" className="scroll-mt-20">
          <KeyManager tenant={tenant} keys={keys} workspaces={visibleWorkspaces.map((w) => w.name)} scoped={scope !== null} />
          <p className="mt-2 text-xs text-fg-muted">A key is you, on a machine: the CLI and the HTTP API. It carries a role no higher than yours and opens no workspace you cannot — narrow it further above.</p>
          <details className="mt-3 rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Using a key</summary>
            <pre className="overflow-x-auto border-t border-line-faint p-4 font-mono text-xs leading-relaxed text-fg-secondary">
{`export FOLDRUN_TOKEN=mda_...
export FOLDRUN_URL=${installOrigin() ?? "https://<this install's address>"}

# deploy a folder of markdown — checked before it goes live
foldrun deploy ./my-workspace --to my-workspace

# call an agent and wait for the answer
curl -X POST "$FOLDRUN_URL/api/workspaces/my-workspace/agents/writer/run?wait=true" \\
  -H "Authorization: Bearer $FOLDRUN_TOKEN" \\
  -d '{"task":"draft a reply"}'`}
            </pre>
          </details>
        </div>

        <SettingsSection wide id="api" title="API" description="How fast this account may call the API, which dated version answers it, and what it has called lately.">
          <ApiSettings facts={apiFacts} qs={qs} />
        </SettingsSection>

        <SettingsSection wide id="secrets" title="Secrets" description="Credentials every workspace can read as ${NAME}. A workspace can override one of these with its own.">
          <Connections tenant={tenant} secrets={secrets} clients={(await listOAuthClients(tenant)).map((c) => ({ name: c.name, scopes: c.scopes }))} connections={await connectionStatus(tenant)} heading={false} callbackUrl={process.env.FOLDRUN_OAUTH_CALLBACK_URL ?? null} />
        </SettingsSection>

        {hooks.length > 0 && (
          <SettingsSection wide id="webhooks" title="Webhook triggers" description="Flows that start when something POSTs their URL. The body becomes the run's input." action={<span className="text-xs text-fg-subtle">{hooks.length}</span>}>
            <Card>
              <ul className="divide-y divide-line-faint">
                {hooks.map((h) => (
                  <li key={`${h.workspace}/${h.flow}`} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-fg">
                        {h.workspace} <span className="text-fg-subtle">/</span> {h.flow}
                      </p>
                      <RotateHookButton workspace={h.workspace} flow={h.flow} />
                    </div>
                    <code className="mt-1 block overflow-x-auto rounded-md bg-sunken px-2 py-1.5 font-mono text-[11px] text-fg-tertiary">{h.path ? `POST ${h.path}` : "webhook URL — visible to admins"}</code>
                    {h.deliveries.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {h.deliveries.map((d, i) => (
                          <li key={i} className="font-mono text-[11px] text-fg-muted">
                            <LocalTime iso={d.t} /> — <span className={d.outcome === "accepted" ? "text-green-700" : "text-red-600"}>{d.outcome}</span>
                            {d.count && d.count > 1 ? ` ×${d.count}` : ""}
                            {d.runId ? ` → ${d.runId}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            <p className="mt-2 text-xs text-fg-muted">
              Rotate one URL above, or rotate <code className="font-mono">FOLDRUN_SECRET_KEY</code> to invalidate every URL at once.
            </p>
          </SettingsSection>
        )}

        <SettingsSection wide id="schedules" title="Scheduled flows" description="Every cron in every workspace, with its next two fires. The scheduler checks every 30 seconds." action={<TickButton />}>
          {scheduled.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-fg-muted">
                No scheduled flows. Add <code className="font-mono text-xs">trigger: schedule</code> and <code className="font-mono text-xs">schedule: &quot;0 8 * * MON&quot;</code> to a flow&apos;s frontmatter.
              </p>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-line-faint">
                {scheduled.map((s) => (
                  <li key={`${s.workspace}/${s.flow}`} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">
                        <Link href={`/dashboard/${s.workspace}${qs}`} className="hover:underline">{s.workspace}</Link>
                        <span className="text-fg-subtle"> / </span>
                        <Link href={`/dashboard/${s.workspace}/edit?path=${encodeURIComponent(`flows/${s.file}`)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`} className="hover:underline">{s.flow}</Link>
                      </p>
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {s.next.length > 0 ? (
                          <>
                            {`next: ${s.next.join(" · ")} (${s.zone})`}
                            <ScheduleInYourTime iso={s.nextIso} zone={s.zone} />
                          </>
                        ) : (
                          "no upcoming fire times"
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={s.valid ? "info" : "error"}><span className="font-mono">{s.schedule}</span></Badge>
                      <Badge>{s.timezone}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </SettingsSection>

        <SettingsSection wide id="about" title="About" description="The version of foldrun this install runs, and the commit of each part behind it." action={<Link href={`/dashboard/whats-new${qs}`} className="text-xs text-accent hover:underline">What&apos;s new</Link>}>
          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <VersionFacts info={versionInfo()} />
            <ComponentTable info={versionInfo()} />
          </Card>
        </SettingsSection>

        <SettingsSection id="flags" title="Feature flags" description="Features the platform turns on account by account. Read-only: the platform team decides them, and foldrun flags lists the same.">
          <Card className="divide-y divide-line-faint p-0">
            {flags.map((f) => (
              <div key={f.name} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-fg">{f.name}</p>
                  <p className="mt-0.5 text-sm text-fg-tertiary">{f.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-fg-subtle">{FLAG_SOURCE[f.source]}</span>
                  <Badge variant={f.on ? "success" : "default"}>{f.on ? "on" : "off"}</Badge>
                </div>
              </div>
            ))}
          </Card>
        </SettingsSection>

        <SettingsSection id="backups" title="Backups" description="Nightly snapshots of the account, restoring a workspace to an earlier point, and asking for a restore of runs, state or storage.">
          <Card className="flex flex-wrap items-center gap-3 p-4 text-sm text-fg-secondary">
            <span className="flex-1">What is backed up and how often, the snapshots this account is in, and the ways to get something back.</span>
            <Link href={`/dashboard/settings/backups${qs}`} className={buttonClass("secondary")}>Open Backups</Link>
          </Card>
        </SettingsSection>

        <SettingsSection id="data" title="Your data" description="A copy of everything the platform holds about this account, and the way out.">
          <AccountData account={tenant} owner={isOwner} hosted={platform.edition() === "hosted"} closeRequestedAt={closeRequestedAt} />
        </SettingsSection>
      </SettingsShell>
    </main>
  );
}
