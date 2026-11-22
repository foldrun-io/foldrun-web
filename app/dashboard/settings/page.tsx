import { WEBHOOK_OUTCOME_LABEL, labelOf } from "@/components/value-labels";
import { $rich, $t } from "@/i18n";
import { scopeAllows } from "@/platform/scope";
import { platform } from "@/lib/platform";
import Link from "@foldrun/ui/react/link";
import { CopyField } from "@/components/copy-field";
import { McpConnections } from "./mcp-connections";
import { connectionView, listGrants } from "@/server/mcp-oauth";
import { ScheduleInYourTime } from "./schedule-in-your-time";
import { cookies } from "next/headers";
import { listApiKeys } from "@/server/auth";
import { can } from "@/platform/permissions";
import { verifySession, listMembers, listInvites, SESSION_COOKIE, viewerScope, viewerRole, viewerEmail } from "@/server/users";
import { PauseCard } from "@/components/pause-card";
import { TelemetryCard } from "@/components/telemetry-card";
import { pauseView } from "@/server/pause";
import { TeamManager } from "./team";
import { accountDir, parseProvider } from "@/lib/store";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsOf, accountDefaultsFor } from "@/components/defaults-model";
import { TimezoneCard, NotifyCard, ConcurrencyCard, ComputeCard, DeployBlockCard, NetworkEnforceCard, OwnerCard, AlertsCard, JudgeCard } from "@/components/defaults-cards";
import { accountCompute, computeInUse, roomWaiting, waitingRunCount, waitingRunsCap } from "@/platform/limits";
import { billing } from "@/platform/billing";
import { AvatarEditor } from "@/components/avatar";
import { avatarUrl } from "@/platform/avatars";
import { listWorkspaces, listFlows } from "@/lib/store";
import { parseCron, cronMatches } from "@/platform/scheduler";
import { SettingsShell, SettingsSection, StatusRow } from "@/components/settings-shell";
import { SettingsCard, EmptyState, Chip, Tag, Callout } from "@foldrun/ui/react/page";
import { buttonVariants } from "@foldrun/ui/react/button";
import { CalendarClock, ScrollText, Webhook } from "lucide-react";
import { settingsTabs, SETTINGS_TABS, type SettingsTab } from "./tabs";
import { CustomersCard } from "./customers";
import { customerLimits, listBlocked, CUSTOMER_DEFAULTS } from "@/platform/customers";
import { spendByCustomer } from "@/platform/model-usage";
import { chargeMargin } from "@/platform/model-gateway";
import { InlineEditor } from "@/components/inline-editor";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** The file's sha256 as GET /api/account/agents-md answers it; null: no file. */
function accountMdSha(tenant: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(path.join(accountDir(tenant), "AGENTS.md"), "utf8")).digest("hex");
  } catch {
    return null;
  }
}

/** The account's own AGENTS.md, as GET /api/account/agents-md answers it. */
function accountAgentsMd(tenant: string): string {
  try {
    return fs.readFileSync(path.join(accountDir(tenant), "AGENTS.md"), "utf8");
  } catch {
    return "";
  }
}
import { BetaFeatures } from "./beta";
import { SettingsAnchor } from "./anchor";
import { KeyManager, TickButton } from "./keys";
import { gatewayLoginOffered, gatewayOffered, gatewayUrl, withGatewaySpend } from "@/server/gateway-keys";
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
import { effectiveFlags, betaProgram } from "@/platform/flags";
import { providerFactsFor } from "@/server/provider-facts";
import { ModelKey } from "./model-key";
import { describeAccountModelNow, modelPresetChoices } from "@/server/account-model";
import { foldrunModelsView } from "@/platform/model-choice";
import { ProviderCheck } from "./provider-check";
import { Email } from "@/components/email";
import { nowMs } from "@/components/overview-model";
import { installOrigin } from "@/server/auth-flows";
import { settingText } from "@/platform/settings";

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
  account: $t("settings.page.setForThisAccount"),
  global: $t("settings.page.setForEveryAccount"),
  rollout: $t("settings.page.stagedRollout"),
  default: "default",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; connected?: string; connect_error?: string; tab?: string }>;
}) {
  const { tenant = "default", connected, connect_error, tab: tabParam } = await searchParams;
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";

  // Who is signed in (nobody, under dev no-auth).
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  // The tab: one of the account's settings pages. An OAuth consent comes
  // back here with ?connected= — that answer is about a secret, so it opens
  // on Secrets.
  const asked = SETTINGS_TABS.includes(tabParam as SettingsTab) ? (tabParam as SettingsTab) : null;
  const tab: SettingsTab = asked === "team" && !session ? "general" : (asked ?? (connected || connect_error ? "secrets" : "general"));
  const tabs = settingsTabs(tenant, { team: Boolean(session), active: tab });

  // A member scoped to some workspaces sees only those, here as everywhere:
  // schedules, repositories, hooks and the invite form all list workspaces.
  const scope = await viewerScope();
  // A signing secret and a webhook URL (which carries its token) are what
  // an admin needs to wire a repository or a sender; the API hands them
  // only to workspace:manage (the rotate route), and so does this page.
  // No session — dev mode — is the owner.
  const role = await viewerRole();
  const managesWorkspaces = role === null || can(role, "workspace:manage");
  const visibleWorkspaces = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name));
  const isOwner = role === null || role === "owner";
  const fm = readAgentsMdKeys(accountDir(tenant));
  // As GET /api/account answers this person: limited to some workspaces,
  // notify's URL and telemetry are "set", never shown (30 Oct 2026).
  const defaults = accountDefaultsFor(defaultsOf(fm), scope);

  const connectedNote =
    connected || connect_error ? (
      <Callout role={connected ? "status" : "alert"} tone={connected ? "success" : "danger"} title={connected ? $t("settings.page.connected") : $t("settings.page.connectFailed")} className="px-4 py-3">
        {connected ? (
          <>
            {$rich("settings.page.theCredentialLandedInTheSecret", { connected: connected, code: (chunks) => <code className="font-mono">{chunks}</code> })}
          </>
        ) : (
          connect_error
        )}
      </Callout>
    ) : undefined;

  return (
    <SettingsShell
      title={$t("settings.page.settings")}
      subtitle={
        <>
          {$rich("settings.page.accountWhoYouAreKeysSecrets", { tenant: tenant, span: (chunks) => <span className="font-mono text-fg-secondary">{chunks}</span> })}
        </>
      }
      tabs={tabs}
      above={connectedNote}
    >
      <SettingsAnchor tenant={tenant} current={tab} tabs={tabs.map((t) => new URL(t.href, "http://x").searchParams.get("tab") ?? "general")} />
      {tab === "general" && (await GeneralTab({ tenant, qs, session, isOwner }))}
      {tab === "team" && session && (await TeamTab({ session, role, scope, workspaces: visibleWorkspaces.map((w) => w.name) }))}
      {tab === "policies" && (await PoliciesTab({ tenant, scope, defaults, managesWorkspaces }))}
      {tab === "models" && (await ModelsTab({ tenant, qs, scope, role, fm }))}
      {tab === "api" && (await ApiTab({ tenant, qs, scope, role, workspaces: visibleWorkspaces.map((w) => w.name) }))}
      {tab === "secrets" && (await SecretsTab({ tenant, scope, role, managesWorkspaces, workspaces: visibleWorkspaces.map((w) => w.name) }))}
      {tab === "schedules" && <SchedulesTab tenant={tenant} qs={qs} amp={amp} workspaces={visibleWorkspaces.map((w) => w.name)} />}
      {tab === "security" && <SecurityTab tenant={tenant} qs={qs} />}
    </SettingsShell>
  );
}

type Session = Awaited<ReturnType<typeof verifySession>>;

/** Who is signed in, the account's face, its defaults, the build, and the way out. */
/** An admin of every workspace (PUT /api/account/beta's rule). */
async function canJoinBeta(): Promise<boolean> {
  const role = await viewerRole();
  return role !== null && can(role, "workspace:manage") && (await viewerScope()) === null;
}

async function GeneralTab({ tenant, qs, session, isOwner }: { tenant: string; qs: string; session: Session; isOwner: boolean }) {
  const fm = readAgentsMdKeys(accountDir(tenant));
  const defaults = accountDefaultsFor(defaultsOf(fm), await viewerScope());
  const flags = await effectiveFlags(tenant);
  const closeRequestedAt = platform.edition() === "hosted" ? ((await adminState(tenant)).closeRequested?.at ?? null) : null;
  const info = versionInfo();
  return (
    <>
      <SettingsSection id="account">
        <SettingsCard title={$t("settings.page.accountPicture")} description={$t("settings.page.shownBesideTheAccountSName")}>
          <AvatarEditor kind="account" id={tenant} name={tenant} src={avatarUrl(tenant, "account", tenant)} tenant={tenant} />
        </SettingsCard>
        <SettingsCard
          title={$t("settings.page.signedIn")}
          description={
            <>
              {session?.email ? <Email value={session.email} /> : $t("settings.page.noOneSignedInDevMode")}{" "}{$rich("settings.page.account", { tenant: tenant, span: (chunks) => <span className="font-mono">{chunks}</span> })}
            </>
          }
          hint={$t("settings.page.yourOwnNamePasswordAndSessions")}
          footer={
            <>
              <Link href={`/dashboard/usage${qs}`} className={buttonVariants({ variant: "secondary" })}>
                {$t("settings.page.usage")}
              </Link>
              {platform.edition() === "hosted" && (
                <Link href={`/dashboard/wallet${qs}`} className={buttonVariants({ variant: "secondary" })}>
                  {$t("settings.page.wallet")}
                </Link>
              )}
              <Link href={`/dashboard/profile${qs}`} className={buttonVariants({ variant: "primary" })}>
                {$t("settings.page.profile")}
              </Link>
            </>
          }
        />
      </SettingsSection>

      <SettingsSection id="defaults">
        <TimezoneCard endpoint="/api/account" tenant={tenant} initial={defaults.timezone} />
      </SettingsSection>

      <SettingsSection id="about">
        <SettingsCard
          title={$t("settings.page.about")}
          description={$t("settings.page.theVersionOfFoldrunThisInstall")}
          footer={
            <Link href={`/dashboard/whats-new${qs}`} className={buttonVariants({ variant: "secondary" })}>
              {$t("settings.page.whatSNew")}
            </Link>
          }
        >
          <div className="space-y-6">
            <VersionFacts info={info} />
            <ComponentTable info={info} />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="beta">
        <SettingsCard title={$t("settings.page.betaFeatures")} description={$t("settings.page.getNewFeaturesBeforeTheyReach")} hint={<code className="font-mono text-xs">foldrun account beta on</code>}>
          <BetaFeatures
            initial={await betaProgram(tenant)}
            flags={flags.filter((f) => f.beta).map(({ name, description, on, source }) => ({ name, description, on, source }))}
            canChange={await canJoinBeta()}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="flags">
        <SettingsCard title={$t("settings.page.featureFlags")} description={$t("settings.page.featuresThePlatformTurnsOnAccount")} hint={<code className="font-mono text-xs">foldrun flags</code>} flush>
          <ul className="divide-y divide-line">
            {flags.map((f) => (
              <li key={f.name} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-fg">{f.name}</p>
                  <p className="mt-0.5 text-sm text-fg-muted">{f.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-fg-muted">{FLAG_SOURCE[f.source]}</span>
                  <Chip tone={f.on ? "good" : "default"}>{f.on ? $t("values.switch.on") : $t("values.switch.off")}</Chip>
                </div>
              </li>
            ))}
          </ul>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="data">
        <AccountData account={tenant} owner={isOwner} hosted={platform.edition() === "hosted"} closeRequestedAt={closeRequestedAt} />
      </SettingsSection>
    </>
  );
}

/** Who can open this account, and what each person may do. */
async function TeamTab({ session, role, scope, workspaces }: { session: NonNullable<Session>; role: Awaited<ReturnType<typeof viewerRole>>; scope: Awaited<ReturnType<typeof viewerScope>>; workspaces: string[] }) {
  const members = (await listMembers(session.tenant)).map((m) => ({ ...m, avatar: avatarUrl(session.tenant, "user", m.id) }));
  // The links still out, for those who may take one back (GET
  // /api/team/invites answers the same, through the same function).
  const invites = role === null || can(role, "team:manage") ? await listInvites(session.tenant, { scope }) : [];
  return (
    <SettingsSection id="team">
      <TeamManager members={members} invites={invites} self={session.email} workspaces={workspaces} />
    </SettingsSection>
  );
}

/** The four jobs (frontmatter-fields.ts JOBS): governance, guardrail, observability, evaluation. */
async function PoliciesTab({
  tenant,
  scope,
  defaults,
  managesWorkspaces,
}: {
  tenant: string;
  scope: Awaited<ReturnType<typeof viewerScope>>;
  defaults: ReturnType<typeof accountDefaultsFor>;
  managesWorkspaces: boolean;
}) {
  const halt = await pauseView(tenant, null, scope);
  const pause = <PauseCard tenant={tenant} scope="account" own={halt.account} mayManage={managesWorkspaces && scope === null} />;
  const pausedOnTheirOwn = Object.keys(halt.workspaces ?? {});
  return (
    <>
      {/* Each card holds its own copy of its key: keyed by that value, it is
          remounted when the value changes on the server (the AGENTS.md editor
          below wrote it) and never because a sibling card saved, so pending
          edits elsewhere are kept (Codex review). */}
      <SettingsSection id="governance" title={$t("settings.page.governance")} description={$t("settings.page.whoAnswersForTheAgentsWhat")}>
        {halt.account && pause}
        <OwnerCard key={JSON.stringify(defaults.owner ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.owner} />
        {/* The plan's number, not the install's alone: until 26 Oct 2026 this read only FOLDRUN_PLAN_CONCURRENCY, so a customer on a plan saw the wrong figure. */}
        <ConcurrencyCard
          key={JSON.stringify(defaults.concurrency ?? null)}
          endpoint="/api/account"
          tenant={tenant}
          initial={defaults.concurrency}
          plan={(await billing().plan(tenant))?.concurrency ?? (Number(settingText("FOLDRUN_PLAN_CONCURRENCY")) > 0 ? Number(settingText("FOLDRUN_PLAN_CONCURRENCY")) : null)}
        />
        <ComputeCard
          key={JSON.stringify(defaults.compute ?? null)}
          endpoint="/api/account"
          tenant={tenant}
          initial={defaults.compute}
          pool={await accountCompute(tenant)}
          inUse={computeInUse(tenant, scope)}
          waiting={roomWaiting(tenant, scope)}
          runsWaiting={{ waiting: scope ? null : waitingRunCount(tenant), limit: (await waitingRunsCap(tenant)).limit }}
        />
        <DeployBlockCard key={JSON.stringify(defaults.deployBlock ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.deployBlock} />
        <p className="px-1 text-sm text-fg-muted">{$t("settings.page.alsoGovernanceTheAccountBudgetBilling")}</p>
      </SettingsSection>

      <SettingsSection id="guardrail" title={$t("settings.page.guardrail")} description={$t("settings.page.whatTheAgentsMayReachAnd")}>
        <NetworkEnforceCard key={JSON.stringify(defaults.networkEnforce ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.networkEnforce} />
        <p className="px-1 text-sm text-fg-muted">{$t("settings.page.eachAgentSOwnLimitsNetwork")}</p>
      </SettingsSection>

      <SettingsSection id="observability" title={$t("settings.page.observability")} description={$t("settings.page.whatRunsRecordAndWhoIs")}>
        <NotifyCard key={JSON.stringify(defaults.notify ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.notify} scopeNote={$t("settings.page.everyWorkspaceInheritsThisUntilIt")} />
        <AlertsCard key={JSON.stringify(defaults.alerts ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.alerts} />
        <TelemetryCard key={JSON.stringify(defaults.telemetry ?? null)} tenant={tenant} initial={defaults.telemetry} mayEdit={managesWorkspaces && scope === null} />
      </SettingsSection>

      <SettingsSection id="evaluation" title={$t("settings.page.evaluation")} description={$t("settings.page.howTheAgentsWorkIsJudged")}>
        <JudgeCard key={JSON.stringify(defaults.judge ?? null)} endpoint="/api/account" tenant={tenant} initial={defaults.judge} />
      </SettingsSection>

      <SettingsSection id="agents-md" title="AGENTS.md" description={$t("settings.page.theAccountSOwnAgentsMd")}>
        {scope !== null ? (
          <p className="px-1 text-sm text-fg-muted">{$t("settings.page.itIsEveryWorkspaceSOnly")}</p>
        ) : (
          <SettingsCard title={$t("settings.page.theAccountSAgentsMd")} description={$t("settings.page.proseEveryAgentReadsAboveIts")}>
            <InlineEditor accountFile accountFileSha={accountMdSha(tenant)} tenant={tenant} path="AGENTS.md" initialContent={accountAgentsMd(tenant)} rows={18} hideSibling bare />
            {!managesWorkspaces && <p className="mt-2 text-xs text-fg-muted">{$t("settings.page.anAdminSavesChangesYoursWould")}</p>}
          </SettingsCard>
        )}
      </SettingsSection>

      {!halt.account && (
        <SettingsSection id="pause-runs" title={$t("settings.page.dangerZone")} danger>
          {pause}
          {pausedOnTheirOwn.length > 0 && <p className="px-1 text-sm text-fg-muted">{$t("settings.page.pausedOnTheirOwnEachResumes", { join: pausedOnTheirOwn.join(", ") })}</p>}
        </SettingsSection>
      )}
      {halt.account && pausedOnTheirOwn.length > 0 && <p className="px-1 text-sm text-fg-muted">{$t("settings.page.pausedOnTheirOwnEachResumes", { join: pausedOnTheirOwn.join(", ") })}</p>}
    </>
  );
}

/** Where model calls go for every workspace that does not name its own provider. */
async function ModelsTab({
  tenant,
  qs,
  scope,
  role,
  fm,
}: {
  tenant: string;
  qs: string;
  scope: Awaited<ReturnType<typeof viewerScope>>;
  role: Awaited<ReturnType<typeof viewerRole>>;
  fm: ReturnType<typeof readAgentsMdKeys>;
}) {
  const provider = parseProvider(fm.provider);
  // The provider check, as GET /api/account/providers answers it — for a
  // scoped member, the account's blocks and its own workspaces' only.
  const { configured: providerConfigured, lastCheck: providerLast } = await providerFactsFor(tenant, scope);
  return (
    <SettingsSection id="provider">
      <ModelKey tenant={tenant} initial={{ ...(await describeAccountModelNow(tenant)), foldrunModels: await foldrunModelsView(tenant) }} presets={modelPresetChoices()} mayEdit={role === null || can(role, "secrets:write")} />
      <SettingsCard
        id="gateway"
        title={$t("settings.page.yourOwnGateway")}
        description={
          <>
            {$rich("settings.page.toBringYourOwnGatewayAdd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
          </>
        }
        hint={
          <Link href={`/dashboard/docs/providers${qs}`} className="text-link hover:underline">
            {$t("settings.page.providersReference")}
          </Link>
        }
      >
        <div className="rounded-md border border-line bg-sunken px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="break-all font-mono text-sm text-fg">{provider?.baseUrl ?? "none"}</code>
            <span className="text-xs text-fg-muted">{provider?.baseUrl ? $t("settings.page.setByTheAccountSAgents") : $t("settings.page.noProviderBlockInTheAccount")}</span>
          </div>
          {provider?.models && Object.keys(provider.models).length > 0 && (
            <p className="mt-1.5 font-mono text-xs text-fg-muted">
              {Object.entries(provider.models)
                .map(([tier, id]) => `${tier} → ${id}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </SettingsCard>
      <ProviderCheck tenant={tenant} configured={providerConfigured} initial={providerLast} mayCheck={(role === null || can(role, "run:start")) && scope === null} />
    </SettingsSection>
  );
}

/** API keys, connecting an AI app over MCP, and the API's version and limits. */
async function ApiTab({
  tenant,
  qs,
  scope,
  role,
  workspaces,
}: {
  tenant: string;
  qs: string;
  scope: Awaited<ReturnType<typeof viewerScope>>;
  role: Awaited<ReturnType<typeof viewerRole>>;
  workspaces: string[];
}) {
  const keys = await withGatewaySpend(await listApiKeys(tenant));
  // Connected AI apps (MCP over OAuth): an admin sees every one, anyone else their own.
  const seesAllConnections = role === null || can(role, "keys:manage");
  const me = (await viewerEmail())?.toLowerCase() ?? null;
  const connections = (await listGrants(tenant)).filter((g) => seesAllConnections || g.email.toLowerCase() === me).map(connectionView);
  const apiFacts = await apiFactsFor(tenant, scope);
  const origin = installOrigin() ?? $t("settings.page.httpsThisInstall");
  return (
    <>
      {/* KeyManager carries its own create card and list. */}
      <SettingsSection id="api-keys">
        <KeyManager
          tenant={tenant}
          keys={keys}
          now={nowMs()}
          workspaces={workspaces}
          scoped={scope !== null}
          // A gateway key (Claude Code): offered where the door can read it,
          // to an admin of every workspace; the URL it is pointed at.
          gateway={gatewayOffered() && scope === null ? { url: gatewayUrl(), login: await gatewayLoginOffered(tenant) } : null}
          // For an A2A key: each workspace's flows, and which are published.
          a2aFlows={Object.fromEntries(workspaces.map((w) => [w, listFlows(tenant, w).map((f) => ({ name: f.name, published: f.a2a?.publish === true }))]))}
        />
      </SettingsSection>

      <SettingsSection id="using-a-key">
        <SettingsCard title={$t("settings.page.usingAKey")} description={$t("settings.page.setItInTheShellThen")} flush>
          <pre className="overflow-x-auto bg-sunken px-5 py-4 font-mono text-xs leading-relaxed text-fg-secondary sm:px-6">
            {`export FOLDRUN_TOKEN=fr_api_...
export FOLDRUN_URL=${origin}

# deploy a folder of markdown — checked before it goes live
foldrun deploy ./my-workspace --to my-workspace

# call an agent and wait for the answer
curl -X POST "$FOLDRUN_URL/api/workspaces/my-workspace/agents/writer/run?wait=true" \\
  -H "Authorization: Bearer $FOLDRUN_TOKEN" \\
  -d '{"task":"draft a reply"}'`}
          </pre>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="mcp">
        <SettingsCard
          title={$t("settings.page.connectAnAiAppMcp")}
          description={
            <>
              {$rich("settings.page.claudeCodeClaudeDesktopCursorAnd", { span: (chunks) => <span className="font-mono">{chunks}</span> })}
            </>
          }
          hint={
            <Link href={`/dashboard/docs/mcp${qs}`} className="text-link hover:underline">
              {$t("settings.page.mcpDocs")}
            </Link>
          }
        >
          <div className="space-y-3">
            <CopyField value={`${origin}/api/mcp`} />
            <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">
              {`# with this machine's foldrun sign-in — no key to paste
claude mcp add foldrun -- foldrun mcp
codex mcp add foldrun -- foldrun mcp

# straight to the platform, with a key from above
claude mcp add --transport http foldrun ${origin}/api/mcp \\
  --header "Authorization: Bearer fr_api_..."

# Claude Desktop, Cursor: in the app's MCP settings
{ "mcpServers": { "foldrun": { "command": "foldrun", "args": ["mcp"] } } }`}
            </pre>
            <p className="text-sm text-fg-muted">
              {$t("settings.page.claudeAiAndOtherAppsThat")}
            </p>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection id="mcp-connections">
        <McpConnections connections={connections} everyone={seesAllConnections} />
      </SettingsSection>

      <SettingsSection id="api" title="API" description={$t("settings.page.howFastThisAccountMayCall")}>
        <ApiSettings facts={apiFacts} qs={qs} />
      </SettingsSection>

      <SettingsSection id="customers">
        <CustomersCard
          tenant={tenant}
          limits={await customerLimits(tenant)}
          defaults={CUSTOMER_DEFAULTS}
          blocked={await listBlocked(tenant)}
          spend={await spendByCustomer(tenant, 7, chargeMargin())}
          canManage={scope === null && (role === null || can(role, "workspace:manage"))}
        />
      </SettingsSection>
    </>
  );
}

/** Credentials, and the flows that start when something POSTs their URL. */
async function SecretsTab({
  tenant,
  scope,
  role,
  managesWorkspaces,
  workspaces,
}: {
  tenant: string;
  scope: Awaited<ReturnType<typeof viewerScope>>;
  role: Awaited<ReturnType<typeof viewerRole>>;
  managesWorkspaces: boolean;
  workspaces: string[];
}) {
  // With each secret's health, as GET /api/secrets answers it: the vault
  // knows a name, only the places that used it know whether it still works.
  const health = await secretHealth(tenant);
  const secrets = listSecrets(tenant).map((s) => ({
    ...s,
    health: health[healthKey(s.name, s.scope === "workspace" ? "workspace" : "account")] ?? null,
  }));
  const hooks = workspaces.flatMap((w) => {
    const deliveries = readDeliveries(tenant, w, 5);
    return listFlows(tenant, w)
      .filter((f) => f.trigger === "webhook")
      .map((f) => ({
        workspace: w,
        flow: f.name,
        path: managesWorkspaces ? webhookPath(tenant, w, f.name) : null,
        deliveries: deliveries.filter((d) => d.flow === f.name),
      }));
  });
  return (
    <>
      <SettingsSection id="secrets">
        <Connections
          tenant={tenant}
          secrets={secrets}
          clients={(await listOAuthClients(tenant)).map((c) => ({ name: c.name, scopes: c.scopes, ...(c.device_url ? { device_url: c.device_url } : {}) }))}
          connections={await connectionStatus(tenant)}
          heading={false}
          callbackUrl={process.env.FOLDRUN_OAUTH_CALLBACK_URL ?? null}
          limitTo={scope === null && (role === null || can(role, "secrets:write")) ? listWorkspaces(tenant).map((w) => w.name) : undefined}
        />
      </SettingsSection>

      {hooks.length > 0 && (
        <SettingsSection id="webhooks" title={$t("settings.page.webhookTriggers")} description={$t("settings.page.flowsThatStartWhenSomethingPosts")} action={<span className="text-sm tabular-nums text-fg-muted">{hooks.length}</span>}>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <ul className="divide-y divide-line">
              {hooks.map((h) => (
                <li key={`${h.workspace}/${h.flow}`} className="px-5 py-3.5 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                      <Webhook aria-hidden className="size-4 shrink-0 text-fg-muted" />
                      <span className="truncate">
                        {h.workspace} <span className="text-fg-subtle">/</span> {h.flow}
                      </span>
                    </p>
                    <RotateHookButton workspace={h.workspace} flow={h.flow} />
                  </div>
                  <code className="mt-2 block overflow-x-auto rounded-md border border-line bg-sunken px-2.5 py-1.5 font-mono text-xs text-fg-secondary">{h.path ? `POST ${h.path}` : $t("settings.page.webhookUrlVisibleToAdmins")}</code>
                  {h.deliveries.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {h.deliveries.map((d, i) => (
                        <li key={i} className="font-mono text-xs text-fg-muted">
                          <LocalTime iso={d.t} /> — <span className={d.outcome === "accepted" ? "text-success" : "text-danger"}>{labelOf(WEBHOOK_OUTCOME_LABEL, d.outcome)}</span>
                          {d.count && d.count > 1 ? ` ×${d.count}` : ""}
                          {d.runId ? ` → ${d.runId}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 px-1 text-sm text-fg-muted">
            {$rich("settings.page.rotateOneUrlAboveOrRotate", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
          </p>
        </SettingsSection>
      )}
    </>
  );
}

/** Every cron in every workspace, with its next two fires. */
function SchedulesTab({ tenant, qs, amp, workspaces }: { tenant: string; qs: string; amp: string; workspaces: string[] }) {
  const scheduled = workspaces.flatMap((w) =>
    listFlows(tenant, w)
      .filter((f) => f.trigger === "schedule" && f.schedule)
      .map((f) => {
        const fires = nextFires(f.schedule!, f.timezone ?? "UTC");
        return {
          workspace: w,
          flow: f.name,
          file: f.file,
          schedule: f.schedule!,
          timezone: f.timezone ?? "UTC",
          valid: parseCron(f.schedule!) !== null,
          next: fires.local,
          nextIso: fires.iso,
          zone: f.timezone ?? "UTC",
        };
      }),
  );
  return (
    <SettingsSection id="schedules" title={$t("settings.page.scheduledFlows")} description={$t("settings.page.everyCronInEveryWorkspaceWith")} action={<TickButton />}>
      {scheduled.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={$t("settings.page.noScheduledFlows")}
          description={
            <>
              {$rich("settings.page.addTriggerScheduleAndSchedule0", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
            </>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line">
            {scheduled.map((s) => (
              <li key={`${s.workspace}/${s.flow}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="truncate text-sm font-medium text-fg">
                    <Link href={`/dashboard/${s.workspace}${qs}`} className="hover:underline">
                      {s.workspace}
                    </Link>
                    <span className="text-fg-subtle"> / </span>
                    <Link href={`/dashboard/${s.workspace}/edit?path=${encodeURIComponent(`flows/${s.file}`)}${amp}`} className="hover:underline">
                      {s.flow}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm text-fg-muted">
                    {s.next.length > 0 ? (
                      <>
                        {$t("settings.page.next", { v0: String(s.next.join(" · ")), zone: String(s.zone) })}
                        <ScheduleInYourTime iso={s.nextIso} zone={s.zone} />
                      </>
                    ) : (
                      $t("settings.page.noUpcomingFireTimes")
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {s.valid ? <Tag mono>{s.schedule}</Tag> : <Chip tone="bad">{s.schedule}</Chip>}
                  <Tag>{s.timezone}</Tag>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsSection>
  );
}

/** Two facts about this install that decide whether it is safe to expose, and the audit log. */
function SecurityTab({ tenant, qs }: { tenant: string; qs: string }) {
  const authRequired = process.env.FOLDRUN_DEV_NO_AUTH !== "1";
  // Where the key that decrypts every secret on this server is kept.
  const keySource = masterKeySource();
  return (
    <SettingsSection id="security">
      <SettingsCard title={$t("settings.page.thisInstall")} description={$t("settings.page.twoFactsThatDecideWhetherIt")} flush>
        <div className="divide-y divide-line">
          <StatusRow
            ok={authRequired}
            title={authRequired ? $t("settings.page.everyApiRequestNeedsAKey") : $t("settings.page.authIsDisabledForLocalDevelopment")}
            detail={
              authRequired
                ? $t("settings.page.theXFoldrunTenantHeaderAlone")
                : $t("settings.page.foldrunDevNoAuth1Is")
            }
          />
          <StatusRow
            ok={keySource.source === "env"}
            title={keySource.source === "env" ? $t("settings.page.theMasterKeyComesFromThe") : $t("settings.page.theMasterKeyIsStoredOn")}
            detail={
              keySource.source === "env" ? (
                $t("settings.page.foldrunSecretKeyIsSetSo")
              ) : (
                <>
                  {$rich("settings.page.theKeyThatDecryptsEverySecret", { tenant: tenant, code: (chunks) => <code className="break-all font-mono">{chunks}</code>, code2: (chunks) => <code className="font-mono">{chunks}</code> })}
                </>
              )
            }
          />
        </div>
      </SettingsCard>
      <SettingsCard
        title={$t("settings.page.auditLog")}
        description={$t("settings.page.signInsKeysInvitesSecretsBy")}
        footer={
          <Link href={`/dashboard/settings/audit${qs}`} className={buttonVariants({ variant: "secondary" })}>
            <ScrollText aria-hidden />
            {$t("settings.page.openAuditLog")}
          </Link>
        }
      />
    </SettingsSection>
  );
}
