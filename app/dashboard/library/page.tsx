import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { AssetRow } from "../[workspace]/assets/asset-row";
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
import { Badge, Card, EmptyScreen, PageHeader } from "@/components/ui";
import { ListSearch } from "@/components/list-search";
import { DeleteLibraryItem } from "./manage";
import { CreateButton } from "@/components/create";
import { startFrom } from "@/server/starters";
import { galleryDrift } from "@/platform/gallery";
import { GalleryDrift } from "./gallery-drift";

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
function UsedBy({ uses, kind }: { uses: LibraryUse[]; kind: LibraryKind }) {
  const where = (u: LibraryUse) => (u.agent ? `${u.workspace}/${u.agent}` : u.workspace);
  const used = uses.filter((u) => u.relation === "use");
  const shadowed = uses.filter((u) => u.relation === "shadowed");

  // Only tools have an opt-in, so only tools can be unused. For every other
  // kind, in-scope means available — saying "used by nobody" would be false.
  if (!used.length && !shadowed.length) {
    return kind === "tools" ? (
      <p className="mt-1.5 text-xs text-fg-subtle">No agent has granted it with `tools:` yet</p>
    ) : null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {used.length > 0 && (
        <>
          <span className="text-xs text-fg-subtle">Used by</span>
          {used.map((u) => (
            <Badge key={`u-${where(u)}`} variant="info">
              {where(u)}
            </Badge>
          ))}
        </>
      )}
      {shadowed.map((u) => (
        <Badge key={`s-${where(u)}`} variant="warning">
          overridden in {where(u)}
        </Badge>
      ))}
    </div>
  );
}

// Tools and Code describe each other on purpose. A tool is the unit an
// agent is granted; a script is code one kind of tool points at, and is not
// a capability on its own. Saying that on both pages is cheaper than
// letting people discover it by granting a script that never runs.
const BLURB: Record<LibraryKind, string> = {
  skills: "Capabilities in the open Agent Skills format, available to every workspace in this account.",
  scripts: "Code that script tools run, mounted as library/<file>. A file here is not a capability until a tool points at it.",
  memory: "What agents have learned, shared across workspaces. One fact per file; the index is generated.",
  knowledge: "Reference material you give agents — specs, price lists, brand guidelines. Read, never rewritten.",
  tools: "What an agent can do — an API, a script, or an MCP server. One definition, granted by name with `tools: [name]`.",
  hooks: "Your own code at every tool call, step start or step end, on every model — one folder each, hook.md beside run.mjs. Turned on by name with `hooks: [name]`, or for every agent from an AGENTS.md.",
};

const PAGE_TITLE: Partial<Record<LibraryKind, string>> = { scripts: "Code" };

/** Every file in a library folder tool, definition first — the rows' tabs. */
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
    kind === "tools"
      ? entries.map((e) => [e.path, galleryDrift(e.path, (rel) => (libraryFileExists(tenant, "tools", rel) ? readLibraryFile(tenant, "tools", rel) : null))] as const)
      : [],
  );
  const tenantParam = tenant !== "default" ? `&tenant=${tenant}` : "";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title={PAGE_TITLE[kind] ?? kind[0].toUpperCase() + kind.slice(1)}
        subtitle={BLURB[kind]}
      >
        <CreateButton
          kind={kind}
          tenant={tenant}
          scopes={["account"]}
          // "From scratch, or from one of these." A blank tool file is a
          // name and nothing else; a working definition to edit is a much
          // better starting point, and the shelf below already has five.
          variants={startFrom(kind)}
        />
      </PageHeader>




      {entries.length === 0 ? (
        <EmptyScreen
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          }
          title={`No shared ${kind} yet`}
          description={BLURB[kind]}
        />
      ) : (
        <>
        <ListSearch listId="library-list" placeholder={`Search shared ${kind}…`} total={entries.length} noun={kind} />
        <Card>
          <ul id="library-list" className="divide-y divide-line-faint">
            {entries.map((e) => kind === "tools" ? (
              // The same workbench the workspace Tools page has: expand to
              // edit the definition and the program on tabs. The library used
              // to link out to a bare file editor, so a shared tool's code
              // was two pages away from its definition.
              <AssetRow
                key={e.path}
                search={[e.name, e.description, e.path].join(" ")}
                workspace=""
                tenant={tenant}
                path={e.path}
                name={e.name}
                description={e.description}
                kind="tools"
                account
                transport={e.transport}
                files={e.path.endsWith("/tool.md") ? folderFiles(tenant, e.path) : undefined}
                extra={
                  <>
                    {e.transport && <Badge>{e.transport === "http" ? "API" : e.transport}</Badge>}
                    {drift.get(e.path) && (
                      <GalleryDrift tenant={tenant} name={drift.get(e.path)!.entry.name} status={drift.get(e.path)!.status} />
                    )}
                    <UsedBy uses={usage.get(e.name) ?? []} kind={kind} />
                  </>
                }
              />
            ) : (
              <li key={e.path} data-search={[e.name, e.description, e.path].join(" ")} className="group flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/library/edit?kind=${kind}&path=${encodeURIComponent(e.path)}${tenantParam}`}
                      className="truncate text-sm font-semibold text-fg hover:underline"
                    >
                      {e.name}
                    </Link>
                    {e.hasScripts && <Badge variant="info">bundles scripts</Badge>}
                    {/* Which of the three transports this is. A page of tool
                        names whose kinds are invisible is what makes "tool"
                        and "script" read as rival concepts. */}
                    {e.transport && <Badge>{e.transport === "http" ? "API" : e.transport}</Badge>}
                    {e.runs && (
                      <span className="font-mono text-[11px] text-fg-subtle">runs {e.runs}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-fg-muted">
                    {e.description || "No description"}
                  </p>
                  <p className="mt-1 font-mono text-xs text-fg-subtle">{e.path}</p>
                  <UsedBy uses={usage.get(e.name) ?? []} kind={kind} />
                </div>
                <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                  <DeleteLibraryItem
                    kind={kind}
                    tenant={tenant}
                    path={e.path}
                    name={e.name}
                    wholeFolder={kind === "skills" && e.path.endsWith("/SKILL.md")}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        </>
      )}

      <Card className="mt-4 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          How agents reach these
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">
{`# in an agent's agent.md
tools: [google-ads]      # a library tool becomes a callable tool

# resolution order for skills, scripts and memory
agent's own  →  the workspace's  →  this shared layer   (nearest wins)`}
        </pre>
      </Card>
    </main>
  );
}
