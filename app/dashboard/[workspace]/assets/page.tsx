import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { workspaceDir, listAgents, type AgentInfo } from "@/lib/store";
import Link from "next/link";
import { Page, PageHeader, EmptyState, Tag, Chip } from "@/components/kit/page";
import { PageTabs } from "@/components/kit/page-tabs";
import { buttonVariants } from "@/components/kit/button";
import { Tooltip } from "@/components/kit/tooltip";
import { toolsTabs, filesTabs } from "@/components/nav-model";
import { BookOpen, Brain, FileCode, FolderTree, Sparkles, Webhook, Wrench } from "lucide-react";
import { ResourceList, type Row } from "@/components/kit/list";
import { CreateButton } from "@/components/create";
import { kindsAt } from "@/lib/kinds";
import { startFrom } from "@/server/starters";
import { AssetMenu } from "./asset-row";
import { AssetBrowser } from "@/components/asset-drawer";
import { assetOpenId, type AssetItem } from "@/components/asset-fields";
import { readDoc, UNKNOWN_ACTOR } from "@/lib/okf";
import { LIBRARY_KINDS, listLibrary, libraryDir } from "@/lib/library";
import { HooksPanel } from "@/components/hooks-panel";
import { listWorkspaceHooks, HOOK_SAMPLE } from "@/server/hooks";

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

// The header's one line, where the page has tabs: short, the rest is in the
// empty state and the docs.
const LINE: Partial<Record<Kind, string>> = {
  tools: "What an agent here can do — an API, a script or an MCP server, granted with tools: [name].",
  hooks: "Your own code at every tool call, step start or step end, turned on with hooks: [name].",
  knowledge: "Reference material you give agents. They read it and never rewrite it.",
  memory: "What agents in this workspace have learned, one fact per file.",
  skills: "Procedures every agent here can load, in the open Agent Skills format.",
};

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
  // One quiet type and the one state that matters most; every state is in
  // the hover title, so nothing the row used to say is lost.
  const states: { label: string; tone: "bad" | "warn" | "good" | "default" }[] = [
    ...(!doc.type ? [{ label: "no type — not OKF conformant", tone: "bad" as const }] : []),
    ...(doc.stale ? [{ label: `stale since ${doc.staleAfter}`, tone: "bad" as const }] : []),
    ...(doc.status !== "stable" ? [{ label: doc.status, tone: "warn" as const }] : []),
    ...(doc.trust === "unverified" ? [{ label: "unverified", tone: "warn" as const }] : []),
    // A machine wrote it. Distinct from unverified: a person's unchecked
    // note and a model's invention are not the same claim.
    ...(doc.generatedBy && !doc.generatedBy.startsWith("human:") && doc.generatedBy !== UNKNOWN_ACTOR ? [{ label: "machine-written", tone: "warn" as const }] : []),
    // All three tiers, not two: machine-confirmed is not the same visual
    // state as a plain stable concept nobody has questioned.
    ...(doc.trust === "human-reviewed" ? [{ label: `human-reviewed${doc.verifiedAt ? ` ${doc.verifiedAt.slice(0, 10)}` : ""}`, tone: "good" as const }] : []),
    ...(doc.trust === "machine-confirmed" ? [{ label: "machine-confirmed", tone: "default" as const }] : []),
  ];
  const top = states[0];
  return (
    <Tooltip label={[doc.type, ...states.map((x) => x.label)].filter(Boolean).join(" · ")}>
      <span className="inline-flex items-center gap-1.5">
        {doc.type && <Tag>{doc.type}</Tag>}
        {top && <Chip tone={top.tone}>{top.label.replace(/^human-reviewed .*/, "reviewed")}</Chip>}
        {states.length > 1 && <span className="text-xs text-fg-muted">+{states.length - 1}</span>}
      </span>
    </Tooltip>
  );
}

const KIND_ICON = { tools: Wrench, hooks: Webhook, skills: Sparkles, memory: Brain, knowledge: BookOpen, scripts: FileCode } as const;

/** Who in this workspace uses one entry: agent names, or a phrase for "all". */
interface Reach {
  /** Agents by name, or null when the answer is "every agent". */
  agents: string[] | null;
  /** Who turns a hook on at a level above one agent. */
  levels: string[];
  /** Same-named entries nearer an agent, which run instead of this one. */
  overriddenBy: Entry[];
  /** The shared entry this one runs instead of. */
  overrides: Entry | null;
}

function reachOf(e: Entry, kind: Kind, agents: AgentInfo[], all: Entry[], hookOn: Map<string, string[]>): Reach {
  // Nearest wins: an agent's own beats the workspace's beats the account's.
  const rank = (x: Entry) => (x.account ? 0 : x.owner ? 2 : 1);
  const twins = all.filter((x) => x !== e && x.name === e.name && (!x.owner || !e.owner || x.owner === e.owner));
  const overriddenBy = twins.filter((x) => rank(x) > rank(e));
  const overrides = twins.find((x) => rank(x) < rank(e)) ?? null;
  const base = { levels: [] as string[], overriddenBy, overrides };
  if (e.owner) return { ...base, agents: [e.owner] };
  switch (kind) {
    case "tools":
      return { ...base, agents: agents.filter((a) => a.ownTools.includes(e.name)).map((a) => a.name) };
    case "skills": {
      // No `skills:` list means every skill is offered.
      const on = agents.filter((a) => a.skills === null || a.skills.includes(e.name)).map((a) => a.name);
      return { ...base, agents: on.length === agents.length && agents.length > 0 ? null : on };
    }
    case "hooks": {
      const who = hookOn.get(`${e.account ? "account" : "workspace"}:${e.name}`) ?? [];
      return { ...base, agents: who.filter((w) => w !== "account" && w !== "workspace"), levels: who.filter((w) => w === "account" || w === "workspace") };
    }
    case "memory":
    case "knowledge":
      return { ...base, agents: null };
    default:
      return { ...base, agents: [] };
  }
}

function ReachLine({ r, kind }: { r: Reach; kind: Kind }) {
  const head =
    r.levels.length > 0 ? "Every agent" : r.agents === null ? "Every agent" : r.agents.length ? r.agents.join(", ") : <span className="text-fg-subtle">{kind === "scripts" ? "—" : "No agent yet"}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="truncate">{head}</span>
      {r.overriddenBy.length > 0 && <Chip tone="warn">overridden</Chip>}
    </span>
  );
}

function ReachPanel({ r, e, kind, workspace, qs }: { r: Reach; e: Entry; kind: Kind; workspace: string; qs: string }) {
  const agentHref = (a: string) => `/dashboard/${workspace}/agents/${a}${qs}`;
  const scopeOf = (x: Entry) => (x.account ? "shared" : x.owner ? `${x.owner}'s own` : "this workspace's");
  const verb = kind === "tools" ? "Granted to" : kind === "hooks" ? "Turned on for" : kind === "scripts" ? "Run by" : "Read by";
  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium text-fg">{verb}</h3>
        {r.levels.length > 0 && (
          <p className="text-fg-muted">
            Every agent {r.levels.includes("account") ? "in the account" : "in this workspace"}, from {r.levels.includes("account") ? "the account's" : "this workspace's"} AGENTS.md
            <span className="font-mono"> hooks:</span>.
          </p>
        )}
        {r.agents === null ? (
          <p className="text-fg-muted">
            {e.account ? "Every agent in every workspace of this account." : "Every agent in this workspace."}
            {kind === "skills" && " None of them narrows its skills: list."}
          </p>
        ) : r.agents.length === 0 && r.levels.length === 0 ? (
          <p className="text-fg-muted">
            {kind === "tools" ? (
              <>No agent here has granted it with <span className="font-mono">tools: [{e.name}]</span> yet.</>
            ) : kind === "hooks" ? (
              <>Nobody turns it on yet — add <span className="font-mono">hooks: [{e.name}]</span> to an agent or an AGENTS.md.</>
            ) : kind === "scripts" ? (
              "A script runs when a script tool points at it with run:."
            ) : (
              "No agent here loads it."
            )}
          </p>
        ) : r.agents.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {r.agents.map((a) => (
              <li key={a}>
                <Link href={agentHref(a)} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-sunken">
                  <span className="truncate font-medium text-fg">{a}</span>
                  <span className="text-xs text-fg-muted">agent</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {e.owner && <p className="text-xs text-fg-muted">It sits in {e.owner}&apos;s own folder, so only that agent sees it.</p>}
      </section>
      {(r.overriddenBy.length > 0 || r.overrides) && (
        <section className="space-y-2">
          <h3 className="font-medium text-fg">Overrides</h3>
          <ul className="space-y-2 text-fg-muted">
            {r.overriddenBy.map((x) => (
              <li key={x.path} className="flex flex-wrap items-center gap-2">
                <Chip tone="warn">overridden</Chip> {scopeOf(x)} <span className="font-mono text-xs">{x.path}</span> runs instead of this one{x.owner ? ` for ${x.owner}` : ""}.
              </li>
            ))}
            {r.overrides && (
              <li className="flex flex-wrap items-center gap-2">
                <Tag>overrides</Tag> This runs instead of the {scopeOf(r.overrides)} {e.name}.
              </li>
            )}
          </ul>
        </section>
      )}
      {e.account && (
        <p className="text-xs text-fg-muted">
          Shared from the account library — editing it changes every workspace.{" "}
          <Link href={`/dashboard/library?kind=${kind}${qs.replace("?", "&")}`} className="text-link hover:underline">
            Open the library
          </Link>
        </p>
      )}
    </div>
  );
}

export default async function ProjectAssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; kind?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", kind: rawKind } = await searchParams;
  const dir = workspaceDir(tenant, workspace);
  if (!fs.existsSync(dir)) notFound();

  const kind = (KINDS.includes(rawKind as Kind) ? rawKind : "skills") as Kind;
  const agentInfo = listAgents(tenant, workspace);
  const agents = agentInfo.map((a) => a.name);
  // Outer scope first — account, then workspace, then each agent's own. The
  // same order as the Files toggle and the sidebar. Search and paging are
  // the list's own (?q=, ?page=), over every entry.
  const all = [...collectAccount(tenant, kind), ...collect(dir, kind, agents)];
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";

  // Hooks: what the Test tab and Used by need — the event, who turns it on.
  const hooks = kind === "hooks" ? listWorkspaceHooks(tenant, workspace) : [];
  const hookBy = new Map(hooks.map((h) => [`${h.scope}:${h.name}`, h]));
  const hookOn = new Map(hooks.map((h) => [`${h.scope}:${h.name}`, h.onFor]));

  const Icon = KIND_ICON[kind];
  // Tools and hooks are one door with two tabs; knowledge, memory and skills
  // open here as cards from the Files door, so they carry its tabs.
  const door = kind === "tools" || kind === "hooks" ? toolsTabs(workspace, tenant) : kind === "scripts" ? null : filesTabs(workspace, tenant).map((t) => ({ ...t, active: t.href.includes(`scope=${kind}`) }));
  const title = kind === "tools" || kind === "hooks" ? "Tools & hooks" : PAGE_TITLE[kind] ?? kind[0].toUpperCase() + kind.slice(1);

  const reach = new Map(all.map((e) => [e.path, reachOf(e, kind, agentInfo, all, hookOn)]));
  const scopeLabel = (e: Entry) => (e.account ? "Shared" : e.owner ? e.owner : "Workspace");
  const badgesOf = (e: Entry) => okfBadges(dir, e.path, kind, e.account) ?? (e.transport ? <Tag>{e.transport === "http" ? "API" : e.transport}</Tag> : null);

  const items: AssetItem[] = all.map((e) => {
    const h = kind === "hooks" ? hookBy.get(`${e.account ? "account" : "workspace"}:${e.name}`) : undefined;
    return {
      path: e.path,
      name: e.name,
      description: e.description,
      kind,
      account: e.account,
      owner: e.owner,
      transport: e.transport,
      files: e.files,
      scriptArgs: e.scriptArgs,
      // The test resolves a tool by name, workspace first.
      overridden: kind === "tools" && e.account ? all.some((x) => !x.account && !x.owner && x.name === e.name) : undefined,
      hook: h ? { on: h.on, tool: h.tool, timeoutSec: h.timeoutSec, error: h.error, shadowed: h.shadowed, sample: h.on ? JSON.stringify(HOOK_SAMPLE[h.on], null, 2) : undefined } : undefined,
      badges: badgesOf(e),
      usedBy: <ReachPanel r={reach.get(e.path)!} e={e} kind={kind} workspace={workspace} qs={qs} />,
    };
  });

  const rows: Row[] = all.map((e) => ({
    key: assetOpenId(e),
    search: [e.name, e.description, e.path, e.transport ?? "", e.owner ?? "", e.account ? "shared" : ""].join(" "),
    href: `/dashboard/${workspace}/assets?kind=${kind}${qs.replace("?", "&")}&open=${encodeURIComponent(assetOpenId(e))}`,
    icon: <Icon />,
    name: e.name,
    sub: e.description || "No description",
    cells: {
      type: badgesOf(e),
      scope: e.account ? <Tag>{scopeLabel(e)}</Tag> : <span className="text-fg-secondary">{scopeLabel(e)}</span>,
      used: <ReachLine r={reach.get(e.path)!} kind={kind} />,
    },
    action: <AssetMenu item={{ path: e.path, name: e.name, kind, account: e.account }} workspace={workspace} tenant={tenant} />,
  }));

  return (
    <Page>
      <PageHeader
        title={title}
        description={LINE[kind] ?? BLURB[kind]}
        actions={
          <>
            {kind !== "tools" && kind !== "hooks" && kind !== "scripts" && (
              <Link href={`/dashboard/${workspace}/edit?scope=${kind}${qs.replace("?", "&")}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
                <FolderTree /> View as files
              </Link>
            )}
            <CreateButton
              kind={kind}
              tenant={tenant}
              workspace={workspace}
              agents={agents}
              variants={startFrom(kind)}
            />
          </>
        }
        className={door ? "mb-6" : undefined}
      />
      {door && <PageTabs tabs={door} />}

      <AssetBrowser items={items} workspace={workspace} tenant={tenant}>
        <ResourceList
          id={`assets-${kind}`}
          search={`Search ${kind}…`}
          nameHeader={kind === "memory" || kind === "knowledge" ? "Document" : kind === "scripts" ? "File" : kind[0].toUpperCase() + kind.slice(1, -1)}
          columns={[
            { key: "type", header: "Type", hide: "lg" },
            { key: "scope", header: "Scope", hide: "sm" },
            { key: "used", header: kind === "tools" ? "Used by" : kind === "hooks" ? "Turned on for" : "Reaches", hide: "md" },
          ]}
          rows={rows}
          empty={<EmptyState icon={<Icon />} title={`No ${kind} in this workspace yet`} description={BLURB[kind]} />}
        />
      </AssetBrowser>
      {kind === "hooks" && <HooksPanel tenant={tenant} workspace={workspace} />}
    </Page>
  );
}
