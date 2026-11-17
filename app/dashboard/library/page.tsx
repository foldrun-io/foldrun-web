import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import fs from "node:fs";
import path from "node:path";
import {
  listLibrary,
  libraryUsage,
  libraryDir,
  readLibraryFile,
  libraryFileExists,
  LIBRARY_KINDS,
  type LibraryKind,
  type LibraryUse,
} from "@/lib/library";
import { Page, PageHeader, EmptyState, Tag, Chip, Panel } from "@foldrun/ui/react/page";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { ResourceList, type Row } from "@foldrun/ui/react/list";
import { libraryTabs } from "@/components/nav-model";
import { BookOpen, Brain, FileCode, Sparkles, Webhook, Wrench } from "lucide-react";
import { CreateButton } from "@/components/create";
import { startFrom } from "@/server/starters";
import { galleryDrift } from "@/platform/gallery";
import { GalleryDrift } from "./gallery-drift";
import { AssetMenu } from "../[workspace]/assets/asset-row";
import { AssetBrowser } from "@/components/asset-drawer";
import { assetOpenId, type AssetItem } from "@/components/asset-fields";

export const dynamic = "force-dynamic";

/**
 * What depends on one shared file.
 *
 * The account library is where one edit changes workspaces you aren't looking
 * at, and until now nothing said which. Two things worth knowing, and they are
 * not the same thing:
 *
 *   used by     an agent named this tool in `tools:`. This is the blast radius —
 *               rotate the credential and exactly these agents are affected.
 *   overridden  a nearer file of the same name wins, so what you are reading
 *               is *not* what runs there. Nearest-wins makes that silent, so
 *               it is called out rather than left to be discovered.
 */
const where = (u: LibraryUse) => (u.agent ? `${u.workspace}/${u.agent}` : u.workspace);

/** The row's one line: who uses it, and how many places override it. */
function UsedByLine({ uses, kind }: { uses: LibraryUse[]; kind: LibraryKind }) {
  const used = uses.filter((u) => u.relation === "use");
  const shadowed = uses.filter((u) => u.relation === "shadowed");
  // Only tools have an opt-in, so only tools can be unused. For every other
  // kind, in-scope means available — saying "used by nobody" would be false.
  const head = used.length ? used.map(where).join(", ") : kind === "tools" ? <span className="text-fg-subtle">{$t("library.page.noAgentYet")}</span> : $t("library.page.everyWorkspace");
  return (
    <span className="inline-flex items-center gap-2">
      <span className="truncate">{head}</span>
      {shadowed.length > 0 && <Chip tone="warn">{$t("library.page.overriddenIn", { length: String(shadowed.length) })}</Chip>}
    </span>
  );
}

/** The drawer's Used by tab: the same facts, each one a link. */
function UsedByPanel({ uses, kind, tenant }: { uses: LibraryUse[]; kind: LibraryKind; tenant: string }) {
  const used = uses.filter((u) => u.relation === "use");
  const shadowed = uses.filter((u) => u.relation === "shadowed");
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const href = (u: LibraryUse) => (u.agent ? `/dashboard/${u.workspace}/agents/${u.agent}${qs}` : `/dashboard/${u.workspace}${qs}`);
  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium text-fg">{kind === "tools" ? $t("library.page.grantedTo") : $t("library.page.availableTo")}</h3>
        {kind !== "tools" ? (
          <p className="text-fg-muted">{$t("library.page.everyAgentInEveryWorkspaceOf")}</p>
        ) : used.length === 0 ? (
          <p className="text-fg-muted">{$rich("library.page.noAgentHasGrantedItWith", { span: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {used.map((u) => (
              <li key={where(u)}>
                <Link href={href(u)} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-sunken">
                  <span className="truncate font-medium text-fg">{u.agent}</span>
                  <span className="truncate text-xs text-fg-muted">{u.workspace}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {kind === "tools" && <p className="text-xs text-fg-muted">{$t("library.page.rotateACredentialItUsesAnd")}</p>}
      </section>
      {shadowed.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium text-fg">{$t("library.page.overriddenIn2")}</h3>
          <p className="text-fg-muted">{$t("library.page.aNearerFileOfTheSame")}</p>
          <ul className="divide-y divide-line rounded-lg border border-warning-line">
            {shadowed.map((u) => (
              <li key={`s-${where(u)}`}>
                <Link href={href(u)} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-sunken">
                  <span className="truncate font-medium text-fg">{where(u)}</span>
                  <Chip tone="warn">{$t("library.page.overridden")}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Tools and Code describe each other on purpose. A tool is the unit an
// agent is granted; a script is code one kind of tool points at, and is not
// a capability on its own. Saying that on both pages is cheaper than
// letting people discover it by granting a script that never runs.
const BLURB: Record<LibraryKind, string> = {
  skills: $t("library.page.capabilitiesInTheOpenAgentSkills"),
  scripts: $t("library.page.codeThatScriptToolsRunMounted"),
  memory: $t("library.page.whatAgentsHaveLearnedSharedAcross"),
  knowledge: $t("library.page.referenceMaterialYouGiveAgentsSpecs"),
  tools: $t("library.page.whatAnAgentCanDoAn"),
  hooks: $t("library.page.yourOwnCodeAtEveryTool"),
};

const KIND_ICON = { tools: Wrench, hooks: Webhook, skills: Sparkles, memory: Brain, knowledge: BookOpen, scripts: FileCode } as const;

/** Every file in a library folder tool, definition first — the Source tab's files. */
function folderFiles(tenant: string, manifest: string): string[] {
  const folder = manifest.slice(0, manifest.lastIndexOf("/"));
  const dir = path.join(libraryDir(tenant, "tools"), folder);
  if (!fs.existsSync(dir)) return [manifest];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(md|mjs|js|ts|py|sh|rb|json|ya?ml|txt)$/i.test(f))
    .map((f) => `${folder}/${f}`)
    .sort((a, b) => Number(b.endsWith("tool.md")) - Number(a.endsWith("tool.md")));
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; kind?: string }>;
}) {
  const { tenant = "default", kind: rawKind } = await searchParams;
  const kind = (LIBRARY_KINDS.includes(rawKind as LibraryKind) ? rawKind : "skills") as LibraryKind;
  const entries = listLibrary(tenant, kind);
  // Computed once for the page rather than per row: every lookup walks the
  // same workspaces and agents, so doing it inside the map would rescan the
  // account once per entry.
  const usage = new Map(entries.map((e) => [e.name, libraryUsage(tenant, kind, e.name)]));
  // Which tools came from the gallery, and whether the copy still matches
  // what the platform ships. An install is a copy; this is the only place
  // that says when the copy has fallen behind.
  const drift = new Map(
    kind === "tools" || kind === "skills"
      ? entries.map((e) => [e.path, galleryDrift(e.path, (rel) => (libraryFileExists(tenant, kind, rel) ? readLibraryFile(tenant, kind, rel) : null), kind)] as const)
      : [],
  );
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";

  const Icon = KIND_ICON[kind];

  const items: AssetItem[] = entries.map((e) => {
    const d = drift.get(e.path);
    return {
      path: e.path,
      name: e.name,
      description: e.description,
      kind,
      account: true,
      transport: e.transport,
      // A folder tool or hook is one thing with several files; Source edits them all.
      files: kind === "tools" && e.path.endsWith("/tool.md") ? folderFiles(tenant, e.path) : kind === "hooks" ? e.files : undefined,
      usedBy: <UsedByPanel uses={usage.get(e.name) ?? []} kind={kind} tenant={tenant} />,
      notice: d ? <GalleryDrift tenant={tenant} name={d.entry.name} status={d.status} /> : undefined,
    };
  });

  const rows: Row[] = entries.map((e) => {
    const d = drift.get(e.path);
    return {
      key: e.path,
      search: [e.name, e.description, e.path, e.transport ?? ""].join(" "),
      href: `/dashboard/library?kind=${kind}${tenantParam}&open=${encodeURIComponent(assetOpenId({ path: e.path, account: true }))}`,
      icon: <Icon />,
      name: e.name,
      sub: e.description || $t("library.page.noDescription"),
      cells: {
        // Which of the three transports this is. A page of tool names whose
        // kinds are invisible is what makes "tool" and "script" read as
        // rival concepts.
        type: (
          <span className="inline-flex items-center gap-1.5">
            {e.transport && <Tag>{e.transport === "http" ? "API" : e.transport}</Tag>}
            {e.hasScripts && <Tag>{$t("library.page.bundlesScripts")}</Tag>}
            {e.runs && <Tag mono>{$t("library.page.runs", { runs: e.runs })}</Tag>}
            {d && (d.status === "current" ? <Tag>{$t("library.page.gallery")}</Tag> : <Chip tone="warn">{$t("library.page.galleryDiffers")}</Chip>)}
          </span>
        ),
        used: <UsedByLine uses={usage.get(e.name) ?? []} kind={kind} />,
      },
      action: <AssetMenu item={{ path: e.path, name: e.name, kind, account: true }} workspace="" tenant={tenant} />,
    };
  });

  return (
    <Page>
      <PageHeader
        title={$t("library.page.library")}
        description={BLURB[kind]}
        actions={
          <CreateButton
            kind={kind}
            tenant={tenant}
            scopes={["account"]}
            // "From scratch, or from one of these." A blank tool file is a
            // name and nothing else; a working definition to edit is a much
            // better starting point, and the shelf below already has five.
            variants={startFrom(kind)}
          />
        }
        className="mb-6"
      />
      <PageTabs tabs={libraryTabs(tenant)} />

      <AssetBrowser items={items} workspace="" tenant={tenant}>
        <ResourceList
          id={`library-${kind}`}
          search={$t("library.page.searchShared", { kind: String(kind) })}
          nameHeader={kind === "memory" || kind === "knowledge" ? $t("library.page.document") : kind[0].toUpperCase() + kind.slice(1, -1)}
          columns={[
            { key: "type", header: $t("library.page.type"), hide: "sm" },
            { key: "used", header: kind === "tools" ? $t("library.page.usedBy") : $t("library.page.reaches"), hide: "md" },
          ]}
          rows={rows}
          empty={<EmptyState icon={<Icon />} title={$t("library.page.noSharedYet", { kind: String(kind) })} description={BLURB[kind]} />}
        />
      </AssetBrowser>

      <Panel title={$t("library.page.howAgentsReachThese")} className="mt-10" bodyClassName="p-0">
        <pre className="overflow-x-auto bg-sunken p-4 font-mono text-xs leading-relaxed text-fg-secondary">
{`# in an agent's agent.md
tools: [google-ads]      # a library tool becomes a callable tool

# resolution order for skills, scripts and memory
agent's own  →  the workspace's  →  this shared layer   (nearest wins)`}
        </pre>
      </Panel>
    </Page>
  );
}
