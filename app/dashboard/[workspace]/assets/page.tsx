import Link from "next/link";
import { Pager } from "@/components/pager";
import { paginate, pageFrom } from "@/components/paging";
import { WorkspaceHeader } from "@/components/workspace-header";
import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents } from "@/lib/store";
import { Card, EmptyScreen, PageHeader } from "@/components/ui";
import { ListSearch } from "@/components/list-search";
import { filterByQuery } from "@/components/list-search-model";
import { CreateButton } from "@/components/create";
import { kindsAt } from "@/lib/kinds";
import { startFrom } from "@/server/starters";
import { AssetRow } from "./asset-row";
import { readDoc, UNKNOWN_ACTOR } from "@/lib/okf";
import { LIBRARY_KINDS, listLibrary, libraryDir } from "@/lib/library";
import { Badge } from "@/components/ui";
import { HooksPanel } from "@/components/hooks-panel";

export const dynamic = "force-dynamic";

// The nouns this page lists. Derived, not retyped — a hand-kept copy is how
// a new kind gets a menu entry and no page, or a page and no menu entry.
const KINDS = kindsAt("workspace").filter((k) => k !== "agents" && k !== "flows" && k !== "evals");
type Kind = (typeof KINDS)[number];

// See the note on the account library's BLURB: a tool is the capability, a
// script is material one kind of tool points at.
const BLURB: Record<Kind, string> = {
  skills: "Capabilities every agent in this workspace can load, in the open Agent Skills format.",
  memory: "What agents in this workspace have learned. One fact per file; the index is generated and loaded into every run.",
  knowledge: "Reference material you give agents — specs, price lists, guidelines. Loaded like memory, but agents never rewrite it.",
  tools: "What an agent here can do — an API, a script, or an MCP server. Granted by name with `tools: [name]`; credentials resolve server-side.",
  hooks: "Your own code at every tool call, step start or step end, on every model — one folder each, hook.md beside run.mjs. Turned on with `hooks: [name]` in an agent, or for every agent from an AGENTS.md.",
  scripts: "Code that script tools run, referenced as shared/<file>. A file here is not a capability until a tool points at it.",
};

const PAGE_TITLE: Partial<Record<Kind, string>> = { scripts: "Code" };

interface Entry {
  path: string; // relative to the workspace root, or to the library kind dir
  name: string;
  description: string;
  owner: string | null; // agent name, or null for workspace scope
  /** Set for account-library entries — they're edited through a different API. */
  account?: boolean;
  /** Tools only: how it connects, so the row can offer the right test. */
  transport?: "http" | "script" | "mcp";
  /** For a folder tool: every file in it, so the row can edit them all. */
  files?: string[];
  /** Script tools: the names under `args:`, so the test can supply them. */
  scriptArgs?: string[];
}

function read(file: string) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const get = (k: string) =>
      m?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, "m"))?.[1].replace(/^["']|["']$/g, "").trim() ?? "";
    // `transport:` is current; `type: http` is the pre-v0.1 spelling, and a
    // file using it still loads, so the badge has to understand both.
    const declared = (get("transport") || get("type")).toLowerCase();
    const transport = ["http", "script", "mcp"].includes(declared)
      ? (declared as "http" | "script" | "mcp")
      : get("command") || get("url") ? "mcp"
      : get("run") ? "script"
      : get("base") ? "http"
      : undefined;
    // The keys under `args:` — an indented block, so not a scalar `get`.
    const argBlock = m?.[1].match(/^args:\s*\n((?:[ \t]+\S.*\n?)+)/m)?.[1] ?? "";
    const scriptArgs = [...argBlock.matchAll(/^\s+([a-z][a-z0-9_]*):/gim)].map((x) => x[1]);

    return {
      name: get("name"),
      // OKF's human label. Ours is `name`, and only for the platform's kinds:
      // in a bundle the standard's field is the one a reader expects.
      title: get("title"),
      description: get("description"),
      transport,
      scriptArgs,
    };
  } catch {
    return { name: "", title: "", description: "", transport: undefined, scriptArgs: [] };
  }
}

/** A tool folder's editable files, manifest first, deepest last. */
function folderFiles(dir: string, prefix: string, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) out.push(...folderFiles(path.join(dir, e.name), `${prefix}/${e.name}`, depth + 1));
    else if (/\.(md|mjs|js|ts|py|sh|rb|json|ya?ml|txt)$/i.test(e.name)) out.push(`${prefix}/${e.name}`);
  }
  // The definition first: it is what the tool *is*, and what a reader opens
  // the row to check.
  const manifest = (f: string) => Number(f.endsWith("/tool.md") || f.endsWith("/hook.md"));
  return out.sort((a, b) => manifest(b) - manifest(a));
}

// Collect a kind at workspace scope and from every agent, so one page answers
// "what skills/memory/tools exist anywhere in this workspace?".
function collect(dir: string, kind: Kind, agents: string[]): Entry[] {
  const out: Entry[] = [];

  const isBundle = kind === "memory" || kind === "knowledge";

  // `within` is the path inside the bundle. OKF makes that path the concept's
  // identity — the spec's own example is `sales/tables/orders.md` — so a
  // bundle is a tree, and stopping at the top level hid every concept in a
  // section. gauges/ and policies/ existed, were indexed, and were reachable
  // by an agent, while this page showed nothing at all.
  const scan = (base: string, prefix: string, owner: string | null, within = "", depth = 0) => {
    const root = path.join(base, kind, within);
    if (!fs.existsSync(root) || depth > 6) return;
    for (const entry of fs.readdirSync(root).sort()) {
      const full = path.join(root, entry);
      const rel = within ? `${within}/${entry}` : entry;
      const isDir = fs.statSync(full).isDirectory();

      if (kind === "skills" && isDir) {
        const skillMd = path.join(full, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;
        const meta = read(skillMd);
        out.push({
          path: `${prefix}${kind}/${rel}/SKILL.md`,
          name: meta.name || entry,
          description: meta.description,
          owner,
        });
      } else if (kind === "tools" && isDir) {
        // A folder tool is one entry, named by its manifest — the same shape
        // as a skill folder. Without this the directory fell through to the
        // bundle branch, which ignores it, so a tool an agent was actually
        // using did not appear on the page listing tools.
        const manifest = path.join(full, "tool.md");
        if (!fs.existsSync(manifest)) continue;
        const meta = read(manifest);
        out.push({
          path: `${prefix}${kind}/${rel}/tool.md`,
          name: meta.name || entry,
          description: meta.description,
          owner,
          transport: meta.transport,
          scriptArgs: meta.scriptArgs,
          // Everything else in the folder, so the row can edit the code as
          // well as the definition. A tool is one thing; needing the file
          // tree to reach half of it is what made tools feel file-shaped.
          files: folderFiles(full, `${prefix}${kind}/${rel}`),
        });
      } else if (kind === "hooks" && isDir) {
        // A hook is a folder like a tool: hook.md says when it runs, run.mjs
        // what it does. Both are one row, so the code is a tab away.
        const manifest = path.join(full, "hook.md");
        if (!fs.existsSync(manifest)) continue;
        const meta = read(manifest);
        out.push({
          path: `${prefix}${kind}/${rel}/hook.md`,
          name: entry,
          description: meta.description,
          owner,
          files: folderFiles(full, `${prefix}${kind}/${rel}`),
        });
      } else if (isDir) {
        if (isBundle) scan(base, prefix, owner, rel, depth + 1);
      } else {
        // Reserved OKF filenames are bundle structure, not concepts. index.md
        // and log.md recur at every level of the tree, not just its root.
        if (isBundle && ["index.md", "log.md"].includes(entry)) continue;
        const meta = read(full);
        out.push({
          path: `${prefix}${kind}/${rel}`,
          // OKF's label first. `name` is ours and a slug — showing it meant the
          // list read "products" where the file said "Northwind price list".
          name: (isBundle && meta.title) || meta.name || entry,
          description: meta.description,
          owner,
          transport: meta.transport,
          scriptArgs: meta.scriptArgs,
        });
      }
    }
  };

  scan(dir, "", null);
  // Hooks resolve from the workspace's hooks/ and the library only — an
  // agent's own folder is not looked in, so listing one there would lie.
  if (kind !== "hooks") for (const agent of agents) scan(path.join(dir, "agents", agent), `agents/${agent}/`, agent);
  return out;
}

// The account library, listed alongside the workspace's own. An agent sees all
// three scopes merged at run time; splitting them across three pages made the
// reader do a join the platform could do for them.
function collectAccount(tenant: string, kind: Kind): Entry[] {
  if (!LIBRARY_KINDS.includes(kind as never)) return [];
  return listLibrary(tenant, kind as never).map((e) => ({
    path: e.path,
    name: e.name || e.path,
    description: e.description,
    owner: null,
    account: true,
    // An account tool is the same kind of thing as a workspace one, so it
    // gets the same badge — without this an inherited tool rendered as a
    // bare name while the local one beside it said what it was.
    transport: e.transport,
  }));
}

// memory/ and knowledge/ are OKF bundles, so a row can say what the spec says
// about it: its concept type, whether anyone confirmed it, whether it expired.
function okfBadges(dir: string, rel: string, kind: Kind, account = false) {
  if (kind !== "memory" && kind !== "knowledge") return null;
  const base = account ? libraryDir("default", kind as never) : dir;
  const doc = readDoc(path.join(base, path.dirname(rel)), path.basename(rel));
  if (!doc) return null;
  return (
    <>
      {doc.type ? (
        <Badge>{doc.type}</Badge>
      ) : (
        <Badge variant="error">no type — not OKF conformant</Badge>
      )}
      {doc.stale && <Badge variant="error">stale since {doc.staleAfter}</Badge>}
      {doc.status !== "stable" && <Badge variant="warning">{doc.status}</Badge>}
      {/* A machine wrote it. Distinct from unverified: a person's unchecked
          note and a model's invention are not the same claim. */}
      {doc.generatedBy && !doc.generatedBy.startsWith("human:") &&
        doc.generatedBy !== UNKNOWN_ACTOR && <Badge variant="warning">machine-written</Badge>}
      {doc.trust === "unverified" && <Badge variant="warning">unverified</Badge>}
      {/* All three tiers, not two. Rendering machine-confirmed as nothing put
          it in the same visual state as a plain stable concept, so a fact only
          a script had checked looked like one nobody had questioned. */}
      {doc.trust === "machine-confirmed" && <Badge>machine-confirmed</Badge>}
      {doc.trust === "human-reviewed" && (
        <Badge variant="success">
          human-reviewed{doc.verifiedAt ? ` ${doc.verifiedAt.slice(0, 10)}` : ""}
        </Badge>
      )}
    </>
  );
}

export default async function ProjectAssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; kind?: string; page?: string; q?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", kind: rawKind, page: pageParam, q = "" } = await searchParams;
  const dir = workspaceDir(tenant, workspace);
  if (!fs.existsSync(dir)) notFound();

  const kind = (KINDS.includes(rawKind as Kind) ? rawKind : "skills") as Kind;
  const agents = listAgents(tenant, workspace).map((a) => a.name);
  // Outer scope first — account, then workspace, then each agent's own. The
  // same order as the Files toggle and the sidebar.
  const all = [...collectAccount(tenant, kind), ...collect(dir, kind, agents)];
  // Searched before paging: a filter over one page of ten finds nothing.
  const entries = filterByQuery(all, q, (e) => [e.name, e.description, e.path, e.transport ?? ""].join(" "));
  const paged = paginate(entries, pageFrom(pageParam));
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <WorkspaceHeader workspace={workspace} qs={qs} />

      <PageHeader title={PAGE_TITLE[kind] ?? kind[0].toUpperCase() + kind.slice(1)} subtitle={BLURB[kind]}>
        <CreateButton
          kind={kind}
          tenant={tenant}
          workspace={workspace}
          agents={agents}
          variants={startFrom(kind)}
        />
      </PageHeader>

      {all.length > 0 && <ListSearch mode="url" value={q} placeholder={`Search ${kind}…`} total={entries.length} noun={kind} />}
      {all.length === 0 ? (
        <EmptyScreen
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            </svg>
          }
          title={`No ${kind} in this workspace yet`}
          description={BLURB[kind]}
        />
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-fg-subtle">Nothing matches “{q}”.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-line-faint">
            {paged.rows.map((e) => (
              <AssetRow
                key={e.path}
                extra={okfBadges(dir, e.path, kind, e.account)}
                workspace={workspace}
                tenant={tenant}
                path={e.path}
                name={e.name}
                description={e.description}
                kind={kind}
                account={e.account}
                transport={e.transport}
                files={e.files}
                scriptArgs={e.scriptArgs}
              />
            ))}
          </ul>
        </Card>
      )}
      <Pager base={`/dashboard/${workspace}/assets?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}`} page={paged.page} pages={paged.pages} total={paged.total} tenantParam={qs.replace("?", "&")} />
      {kind === "hooks" && <HooksPanel tenant={tenant} workspace={workspace} />}
    </main>
  );
}
