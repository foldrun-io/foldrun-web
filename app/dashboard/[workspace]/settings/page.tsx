// Workspace settings: what belongs to this one workspace — its name, the
// endpoint its runs ride, its secrets, its triggers, and the way to delete
// it. cloudhost's settings: a narrow column of cards, tabs by ?tab=, the
// Danger zone last.

import { HashTab } from "../../settings/anchor";
import Link from "@/components/kit/link";
import fs from "node:fs";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { notFound } from "next/navigation";
import { DeleteButton } from "../../manage";
import { buttonVariants } from "@/components/kit/button";
import { workspaceDir, listFlows, parseProvider, accountDir, listWorkspaces } from "@/lib/store";
import { listSecrets } from "@/lib/secrets";
import { secretHealth, healthKey } from "@/lib/secret-health";
import { parseCron } from "@/platform/scheduler";
import { webhookPath, publicUrl } from "@/lib/webhook";
import { CopyField } from "@/components/copy-field";
import { viewerRole, viewerScope } from "@/server/users";
import { can } from "@/platform/permissions";
import { workspaceBudgetStanding, accountCompute, computeHeld, roomWaiting, workspaceCompute } from "@/platform/limits";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsOf, accountDefaultsFor } from "@/components/defaults-model";
import { BudgetCard, TimezoneCard, NotifyCard, NetworkEnforceCard, OwnerCard, AlertsCard, JudgeCard, ComputeCard } from "@/components/defaults-cards";

import { Page, PageHeader, SettingsCard, EmptyState, Chip, Tag } from "@/components/kit/page";
import { PageTabs } from "@/components/kit/page-tabs";
import { CalendarClock, Webhook, Zap } from "lucide-react";
import { WorkspaceIdentity } from "@/components/workspace-identity";
import { AvatarEditor } from "@/components/avatar";
import { avatarUrl } from "@/platform/avatars";
import { SettingsSection } from "@/components/settings-shell";
import { ExportLink, ImportPackageButton } from "@/components/package-buttons";
import { connectionStatus } from "@/platform/oauth-connections";
import { listOAuthClients } from "@/platform/oauth-clients";
import { Connections } from "../../settings/connections";
import { PauseCard } from "@/components/pause-card";
import { pauseView } from "@/server/pause";

export const dynamic = "force-dynamic";

const TABS = ["general", "policies", "secrets", "triggers"] as const;
type Tab = (typeof TABS)[number];

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; tab?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", tab: tabParam } = await searchParams;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "general";
  if (!fs.existsSync(workspaceDir(tenant, workspace))) notFound();

  // With each secret's health, keyed as GET /api/secrets keys it — an
  // inherited account secret's health is the account entry's, not this one's.
  const health = await secretHealth(tenant);
  const secrets = listSecrets(tenant, workspace).map((s) => ({
    ...s,
    health: health[healthKey(s.name, s.scope === "workspace" ? "workspace" : "account", workspace)] ?? null,
  }));
  const flows = listFlows(tenant, workspace);
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  const scheduled = flows.filter((f) => f.trigger === "schedule" && f.schedule);
  const hooks = flows.filter((f) => f.trigger === "webhook");
  // The URL carries the hook token: shown to workspace:manage, as the API does.
  const role = await viewerRole();
  const managesWorkspace = role === null || can(role, "workspace:manage");
  const { budget, spentUsd: spent } = await workspaceBudgetStanding(tenant, workspace);
  const own = defaultsOf(readAgentsMdKeys(workspaceDir(tenant, workspace)));
  // The account's, as GET /api/account answers this person: limited to
  // some workspaces, its notify URL is "set", not shown (30 Oct 2026).
  const inherited = accountDefaultsFor(defaultsOf(readAgentsMdKeys(accountDir(tenant))), await viewerScope());
  const endpoint = `/api/workspaces/${workspace}`;
  const halt = await pauseView(tenant, workspace);

  // Which endpoint this workspace's model calls ride, resolved the way the
  // runner resolves it: the workspace's provider block, else the account's,
  // else the platform's. Read-only: a provider is a block in AGENTS.md, and
  // this card exists so nobody has to know that to answer "what will my
  // runs use?". The platform's own gateway stays unnamed on purpose.
  const frontOf = (base: string): Record<string, unknown> => {
    try {
      return configMatter(fs.readFileSync(path.join(base, "AGENTS.md"), "utf8")).data as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const wsProvider = parseProvider(frontOf(workspaceDir(tenant, workspace)).provider);
  const acctProvider = wsProvider?.baseUrl ? null : parseProvider(frontOf(accountDir(tenant)).provider);
  const effective = wsProvider?.baseUrl
    ? { label: wsProvider.baseUrl, source: "this workspace's AGENTS.md", models: wsProvider.models }
    : acctProvider?.baseUrl
      ? { label: acctProvider.baseUrl, source: "the account's AGENTS.md", models: acctProvider.models }
      : { label: "The account's model provider", source: "Settings → Model provider", models: {} as Record<string, string> };
  const remaps = Object.entries(effective.models ?? {});
  const agentsMd = `/dashboard/${workspace}/edit?path=AGENTS.md${rest}`;

  const base = `/dashboard/${workspace}/settings`;
  const tabHref = (t: Tab) => (t === "general" ? `${base}${qs}` : `${base}?tab=${t}${rest}`);

  return (
    <Page width="narrow" className="pb-16">
      <PageHeader
        className="mb-6"
        title="Settings"
        description={
          <>
            What belongs to <span className="font-mono text-fg-secondary">{workspace}</span> alone. Keys, account secrets and the team are in{" "}
            <Link href={`/dashboard/settings${qs}`} className="font-medium text-link hover:underline">
              account settings
            </Link>
            .
          </>
        }
      />
      {/* Old one-page links (`…/settings#governance`, `#secrets`, a bookmark,
          a banner) land on the tab that section is on now. */}
      <HashTab
        sections={{
          general: "general", provider: "general", export: "general", danger: "general",
          governance: "policies", guardrail: "policies", observability: "policies", evaluation: "policies", pause: "policies",
          secrets: "secrets", triggers: "triggers",
        }}
        current={tab}
        base={`${base}${qs}`}
        defaultTab="general"
      />
      <PageTabs
        tabs={[
          { label: "General", href: tabHref("general"), active: tab === "general" },
          { label: "Policies", href: tabHref("policies"), active: tab === "policies" },
          { label: "Secrets", href: tabHref("secrets"), active: tab === "secrets", badge: secrets.length || undefined },
          { label: "Triggers", href: tabHref("triggers"), active: tab === "triggers", badge: scheduled.length + hooks.length || undefined },
        ]}
      />

      {tab === "general" && (
        <div>
          <SettingsSection id="general">
            <WorkspaceIdentity
              tenant={tenant}
              workspace={workspace}
              description={listWorkspaces(tenant).find((w) => w.name === workspace)?.description ?? ""}
              webhookFlows={hooks.map((f) => f.name)}
            />
            <SettingsCard title="Picture" description="Shown on the workspace's card, in the switcher and in Find.">
              <AvatarEditor kind="workspace" id={workspace} name={workspace} src={avatarUrl(tenant, "workspace", workspace)} tenant={tenant} square />
            </SettingsCard>
            <TimezoneCard endpoint={endpoint} tenant={tenant} initial={own.timezone} inherited={inherited.timezone} />
          </SettingsSection>

          <SettingsSection id="provider">
            <SettingsCard
              title="Model provider"
              description={
                <>
                  Where this workspace&apos;s model calls go, unless an agent pins its own. To point it elsewhere, add a <code className="font-mono text-xs">provider:</code> block to its AGENTS.md.
                </>
              }
              hint={
                <Link href={`/dashboard/docs/providers${qs}`} className="text-link hover:underline">
                  Providers reference
                </Link>
              }
              footer={
                <Link href={agentsMd} className={buttonVariants({ variant: "secondary" })}>
                  Edit AGENTS.md
                </Link>
              }
            >
              <div className="rounded-md border border-line bg-sunken px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="break-all font-mono text-sm text-fg">{effective.label}</code>
                  <span className="text-xs text-fg-muted">set by {effective.source}</span>
                </div>
                {remaps.length > 0 && <p className="mt-1.5 font-mono text-xs text-fg-muted">{remaps.map(([tier, id]) => `${tier} → ${id}`).join(" · ")}</p>}
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="export">
            <SettingsCard
              title="Export and import"
              description="This workspace as a .zip — agents, flows, tools, skills, scripts, evals and knowledge. Never memory, state, storage, runs or a secret's value; the names of the secrets it uses travel so the importer can set them."
              hint="Import previews what it adds and replaces first."
              footer={
                <>
                  <ImportPackageButton tenant={tenant} workspace={workspace} />
                  <ExportLink workspace={workspace} label="Export workspace" />
                </>
              }
            />
          </SettingsSection>

          <SettingsSection id="danger">
            <SettingsCard
              danger
              title="Delete this workspace"
              description="Its agents, flows, runs, secrets and previews go with it. There is no undo."
              hint="The ledger keeps what its runs cost; everything else is removed."
              footer={<DeleteButton variant="button" endpoint={`/api/workspaces/${workspace}`} tenant={tenant} confirmText={`Delete workspace ${workspace} and everything in it?`} redirectTo={`/dashboard${qs}`} />}
            />
          </SettingsSection>
        </div>
      )}

      {tab === "policies" && (
        <div>
          <SettingsSection id="governance" title="Governance" description="Who answers for this workspace's agents, and what it may spend. In its AGENTS.md: governance:; unset, the account's.">
            {halt.workspace || halt.account ? <PauseCard workspace={workspace} tenant={tenant} scope="workspace" own={halt.workspace ?? null} heldByAccount={halt.account} mayManage={managesWorkspace} /> : null}
            <OwnerCard endpoint={endpoint} tenant={tenant} initial={own.owner} inherited={inherited.owner} />
            <BudgetCard endpoint={endpoint} tenant={tenant} initial={budget} spent={spent} />
            {/* This workspace's own pool (27 Oct 2026): what its running steps may hold together, inside the account's. */}
            <ComputeCard
              endpoint={endpoint}
              tenant={tenant}
              level="workspace"
              initial={own.compute}
              pool={workspaceCompute(tenant, workspace)}
              outer={await accountCompute(tenant)}
              inUse={computeHeld(tenant, [workspace]).workspaces[workspace] ?? { vcpu: 0, memGiB: 0, diskGiB: 0, steps: 0 }}
              waiting={roomWaiting(tenant, [workspace])}
            />
          </SettingsSection>

          <SettingsSection id="guardrail" title="Guardrail" description="What this workspace's agents may reach and call. Each agent's own limits, network and hooks are on its page.">
            <NetworkEnforceCard endpoint={endpoint} tenant={tenant} initial={own.networkEnforce || inherited.networkEnforce} inherited={inherited.networkEnforce} />
          </SettingsSection>

          <SettingsSection id="observability" title="Observability" description="Who is told about this workspace's runs, and when. Set here, notify: and alerts: replace the account's whole.">
            <NotifyCard
              endpoint={endpoint}
              tenant={tenant}
              testWorkspace={workspace}
              initial={own.notify}
              inherited={inherited.notify}
              scopeNote="A workspace's notify: replaces the account's — a URL is a destination, and merging two sends half your alerts to a channel you stopped reading."
            />
            <AlertsCard endpoint={endpoint} tenant={tenant} initial={own.alerts} inherited={inherited.alerts} />
          </SettingsSection>

          <SettingsSection id="evaluation" title="Evaluation" description="How this workspace's work is judged.">
            <JudgeCard endpoint={endpoint} tenant={tenant} initial={own.judge} inherited={inherited.judge} />
            <p className="px-1 text-sm text-fg-muted">
              Its evals and their last results are on the{" "}
              <Link href={`/dashboard/${workspace}/evals${qs}`} className="font-medium text-link hover:underline">
                Evals page
              </Link>
              .
            </p>
          </SettingsSection>

          {!halt.workspace && !halt.account && (
            <SettingsSection id="pause" title="Danger zone" danger>
              <PauseCard workspace={workspace} tenant={tenant} scope="workspace" own={null} heldByAccount={null} mayManage={managesWorkspace} />
            </SettingsSection>
          )}
        </div>
      )}

      {tab === "secrets" && (
        <SettingsSection id="secrets" title="Secrets" description="Credentials this workspace's agents read as ${NAME}. Account secrets are inherited and marked; one set here overrides it.">
          <Connections
            tenant={tenant}
            secrets={secrets}
            clients={(await listOAuthClients(tenant)).map((c) => ({ name: c.name, scopes: c.scopes, ...(c.device_url ? { device_url: c.device_url } : {}) }))}
            connections={await connectionStatus(tenant)}
            workspace={workspace}
            heading={false}
          />
        </SettingsSection>
      )}

      {tab === "triggers" && (
        <SettingsSection
          id="triggers"
          title="Triggers"
          description="What starts a flow here without a person. Set in each flow's frontmatter."
          action={
            <Link href={`/dashboard/${workspace}/flows${qs}`} className={buttonVariants({ variant: "secondary" })}>
              Flows
            </Link>
          }
        >
          {scheduled.length === 0 && hooks.length === 0 ? (
            <EmptyState
              icon={<Zap />}
              title="No scheduled or webhook flows"
              description={
                <>
                  Set <code className="font-mono">trigger:</code> in a flow&apos;s frontmatter to add one.
                </>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <ul className="divide-y divide-line">
                {scheduled.map((f) => (
                  <li key={`cron-${f.file}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
                    <CalendarClock aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`} className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:underline">
                      {f.name}
                    </Link>
                    {parseCron(f.schedule!) === null ? <Chip tone="bad">invalid cron</Chip> : null}
                    <Tag mono>{f.schedule}</Tag>
                    <Tag>{f.timezone ?? "UTC"}</Tag>
                  </li>
                ))}
                {hooks.map((f) => (
                  <li key={`hook-${f.file}`} className="space-y-2 px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-3">
                      <Webhook aria-hidden className="size-4 shrink-0 text-fg-muted" />
                      <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`} className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:underline">
                        {f.name}
                      </Link>
                      <Tag>webhook</Tag>
                    </div>
                    {managesWorkspace ? (
                      <CopyField value={`${publicUrl() ?? ""}${webhookPath(tenant, workspace, f.name)}`} className="w-full min-w-0" />
                    ) : (
                      <code className="block min-w-0 truncate font-mono text-xs text-fg-muted">webhook URL — visible to admins</code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsSection>
      )}
    </Page>
  );
}
