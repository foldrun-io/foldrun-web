// Workspace settings: what belongs to this one workspace — its name, the
// endpoint its runs ride, its secrets, its triggers, and the way to delete
// it. A section list on the left is the map.

import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { configMatter } from "@/lib/matter";
import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/workspace-header";
import { DeleteButton } from "../../manage";
import { workspaceDir, listFlows, parseProvider, accountDir, listWorkspaces } from "@/lib/store";
import { listSecrets } from "@/lib/secrets";
import { secretHealth, healthKey } from "@/lib/secret-health";
import { parseCron } from "@/platform/scheduler";
import { webhookPath, publicUrl } from "@/lib/webhook";
import { CopyField } from "@/components/copy-field";
import { viewerRole } from "@/server/users";
import { can } from "@/platform/permissions";
import { workspaceBudgetStanding, accountCompute, computeHeld, roomWaiting, workspaceCompute } from "@/platform/limits";
import { readAgentsMdKeys } from "@/lib/agents-md";
import { defaultsOf } from "@/components/defaults-model";
import { BudgetCard, TimezoneCard, NotifyCard, NetworkEnforceCard, OwnerCard, AlertsCard, JudgeCard, ComputeCard } from "@/components/defaults-cards";

import { Badge, Card } from "@/components/ui";
import { WorkspaceIdentity } from "@/components/workspace-identity";
import { AvatarEditor } from "@/components/avatar";
import { avatarUrl } from "@/platform/avatars";
import { SettingsShell, SettingsSection } from "@/components/settings-shell";
import { ExportLink, ImportPackageButton } from "@/components/package-buttons";
import { connectionStatus } from "@/platform/oauth-connections";
import { listOAuthClients } from "@/platform/oauth-clients";
import { Connections } from "../../settings/connections";
import { PauseCard } from "@/components/pause-card";
import { pauseView } from "@/server/pause";

export const dynamic = "force-dynamic";

// The four jobs first (frontmatter-fields.ts JOBS), then the setup pages.
const NAV = [
  { id: "governance", label: "Governance", group: "The four jobs" },
  { id: "guardrail", label: "Guardrail", group: "The four jobs" },
  { id: "observability", label: "Observability", group: "The four jobs" },
  { id: "evaluation", label: "Evaluation", group: "The four jobs" },
  { id: "general", label: "General", group: "Setup" },
  { id: "provider", label: "Model provider", group: "Setup" },
  { id: "secrets", label: "Secrets", group: "Setup" },
  { id: "triggers", label: "Triggers", group: "Setup" },
  { id: "export", label: "Export and import", group: "Setup" },
  { id: "danger", label: "Delete", danger: true, group: "Setup" },
];

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default" } = await searchParams;
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
  const inherited = defaultsOf(readAgentsMdKeys(accountDir(tenant)));
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
      : { label: "Models included", source: "the platform", models: {} as Record<string, string> };
  const remaps = Object.entries(effective.models ?? {});
  const agentsMd = `/dashboard/${workspace}/edit?path=AGENTS.md${rest}`;

  return (
    <main>
      <SettingsShell
        nav={NAV}
        title="Workspace settings"
        subtitle={
          <>
            What belongs to <span className="font-mono text-fg-secondary">{workspace}</span> alone. Keys, account secrets and the team are in{" "}
            <Link href={`/dashboard/settings${qs}`} className="font-medium text-fg-secondary underline">account settings</Link>.
          </>
        }
        above={<WorkspaceHeader workspace={workspace} qs={qs} />}
      >
        <SettingsSection id="governance" title="Governance" description="Who answers for this workspace's agents, what it may spend, and the switch that stops it. In its AGENTS.md: governance: (or the same keys at the top); unset, the account's.">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
          </div>
          <div className="mt-3">
          <PauseCard
            workspace={workspace}
            tenant={tenant}
            scope="workspace"
            own={halt.workspace ?? null}
            heldByAccount={halt.account}
            mayManage={managesWorkspace}
          />
          </div>
        </SettingsSection>

        <SettingsSection id="guardrail" title="Guardrail" description="What this workspace's agents may reach and call. Each agent's own limits, network and hooks are on its page.">
          <NetworkEnforceCard endpoint={endpoint} tenant={tenant} initial={own.networkEnforce || inherited.networkEnforce} inherited={inherited.networkEnforce} />
        </SettingsSection>

        <SettingsSection id="observability" title="Observability" description="Who is told about this workspace's runs, and when. Set here, notify: and alerts: replace the account's whole.">
          <div className="grid gap-3">
            <NotifyCard endpoint={endpoint} tenant={tenant} testWorkspace={workspace} initial={own.notify} inherited={inherited.notify} scopeNote="A workspace's notify: replaces the account's — a URL is a destination, and merging two sends half your alerts to a channel you stopped reading." />
            <AlertsCard endpoint={endpoint} tenant={tenant} initial={own.alerts} inherited={inherited.alerts} />
          </div>
        </SettingsSection>

        <SettingsSection id="evaluation" title="Evaluation" description="How this workspace's work is judged.">
          <JudgeCard endpoint={endpoint} tenant={tenant} initial={own.judge} inherited={inherited.judge} />
          <p className="mt-2 text-sm text-fg-tertiary">
            Its evals and their last results are on the <Link href={`/dashboard/${workspace}/evals${qs}`} className="font-medium text-fg-secondary underline">Evals page</Link>.
          </p>
        </SettingsSection>

        <SettingsSection id="general" title="General" description="The name is the folder and the URL; the description is what the card and Find show.">
          <Card className="mb-3 p-5">
            <AvatarEditor kind="workspace" id={workspace} name={workspace} src={avatarUrl(tenant, "workspace", workspace)} tenant={tenant} square />
          </Card>
          <WorkspaceIdentity
            tenant={tenant}
            workspace={workspace}
            description={listWorkspaces(tenant).find((w) => w.name === workspace)?.description ?? ""}
            webhookFlows={hooks.map((f) => f.name)}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TimezoneCard endpoint={endpoint} tenant={tenant} initial={own.timezone} inherited={inherited.timezone} />
          </div>
        </SettingsSection>

        <SettingsSection id="provider" title="Model provider" description="Where this workspace's model calls go, unless an agent pins its own.">
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-sm text-fg">{effective.label}</code>
              <span className="text-xs text-fg-subtle">set by {effective.source}</span>
            </div>
            {remaps.length > 0 && <p className="mt-1.5 font-mono text-xs text-fg-muted">{remaps.map(([tier, id]) => `${tier} → ${id}`).join(" · ")}</p>}
            <p className="mt-2 text-sm text-fg-tertiary">
              To point this workspace elsewhere, add a <code className="font-mono text-xs">provider:</code> block to{" "}
              <Link href={agentsMd} className="font-medium text-fg-secondary underline">AGENTS.md</Link>. The{" "}
              <Link href={`/dashboard/docs/providers${qs}`} className="font-medium text-fg-secondary underline">providers reference</Link> lists the shapes.
            </p>
          </Card>
        </SettingsSection>

        <SettingsSection wide id="secrets" title="Secrets" description="Credentials this workspace's agents read as ${NAME}. Account secrets are inherited and marked; one set here overrides it.">
          <Connections tenant={tenant} secrets={secrets} clients={(await listOAuthClients(tenant)).map((c) => ({ name: c.name, scopes: c.scopes }))} connections={await connectionStatus(tenant)} workspace={workspace} heading={false} />
        </SettingsSection>

        <SettingsSection
          id="triggers" wide
          title="Triggers"
          description="What starts a flow here without a person. Set in each flow's frontmatter."
          action={<Link href={`/dashboard/${workspace}/flows${qs}`} className="text-xs font-medium text-fg-muted hover:text-fg">Flows →</Link>}
        >
          <Card>
            {scheduled.length === 0 && hooks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-fg-muted">
                No scheduled or webhook flows. Set <code className="font-mono">trigger:</code> in a flow&apos;s frontmatter to add one.
              </p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {scheduled.map((f) => (
                  <li key={`cron-${f.file}`} className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`} className="text-sm font-medium text-fg hover:underline">{f.name}</Link>
                    <Badge variant="info">schedule</Badge>
                    <code className="font-mono text-xs text-fg-muted">{f.schedule}</code>
                    <span className="text-xs text-fg-subtle">{f.timezone ?? "UTC"}</span>
                    {parseCron(f.schedule!) === null && <Badge variant="error">invalid cron</Badge>}
                  </li>
                ))}
                {hooks.map((f) => (
                  <li key={`hook-${f.file}`} className="flex flex-wrap items-center gap-2 px-5 py-3">
                    <Link href={`/dashboard/${workspace}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`} className="text-sm font-medium text-fg hover:underline">{f.name}</Link>
                    <Badge variant="info">webhook</Badge>
                    {managesWorkspace ? (
                      <CopyField value={`${publicUrl() ?? ""}${webhookPath(tenant, workspace, f.name)}`} className="w-full min-w-0" />
                    ) : (
                      <code className="min-w-0 truncate font-mono text-xs text-fg-muted">webhook URL — visible to admins</code>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </SettingsSection>

        <SettingsSection
          id="export"
          title="Export and import"
          description="This workspace as a .zip — agents, flows, tools, skills, scripts, evals and knowledge. Never memory, state, storage, runs or a secret's value; the names of the secrets it uses travel so the importer can set them."
        >
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-fg-tertiary">Import shows what a package adds, replaces and still needs before it writes anything.</p>
            <div className="flex items-center gap-2">
              <ImportPackageButton tenant={tenant} workspace={workspace} />
              <ExportLink workspace={workspace} label="Export workspace" />
            </div>
          </Card>
        </SettingsSection>

        <SettingsSection wide id="danger" title="Delete this workspace" description="Its agents, flows, runs, secrets and previews go with it. There is no undo." danger>
          <Card className="flex flex-wrap items-center justify-between gap-3 border-red-200 p-4">
            <p className="text-sm text-fg-tertiary">The ledger keeps what its runs cost; everything else is removed.</p>
            <DeleteButton
              endpoint={`/api/workspaces/${workspace}`}
              tenant={tenant}
              confirmText={`Delete workspace ${workspace} and everything in it?`}
              redirectTo={`/dashboard${qs}`}
            />
          </Card>
        </SettingsSection>
      </SettingsShell>
    </main>
  );
}
