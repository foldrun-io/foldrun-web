// The workspace's files, in the editor shell: a tree with a filter, an
// editor with a header that says what the file is, and a panel with what
// it relates to — who uses it, the secrets it names, its runs, its recent
// changes, a test box for a tool. One directory can be scoped in (state/,
// from the sidebar), which narrows the tree and titles the page.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import matter, { configMatter } from "@/lib/matter";
import { schemaKindOf } from "@/lib/frontmatter-fields";
import {
  workspaceDir, readWorkspaceFile, listWorkspaceFiles, WORKSPACE_DIRS, listAgents, listFlows, listRuns, runDisplayStatus, workspaceTools,
} from "@/lib/store";
import { listSecrets } from "@/lib/secrets";
import { listRevisions } from "@/lib/history";
import { deployIssues } from "@/lib/deploy";
import { checkTree } from "@/lib/workspace-check";
import { workspaceCheck } from "@/server/checks";
import { EditorShell, type ContextSection, type Issue } from "@/components/editor-shell";
import { kindOf, chipsFor, secretRefs, crumbs, DOC_FOR, type FileKind } from "@/components/editor-context-model";
import { nowMs } from "@/components/overview-model";
import { EmptyScreen } from "@/components/ui";
import { NewFile } from "./new-file";

export const dynamic = "force-dynamic";

const SCOPES: Record<string, { title: string; blurb: string; empty?: string; list?: string }> = {
  state: {
    title: "State",
    blurb: "What this workspace carries between runs — a cursor, a count, where you got to. Agents read these at the start of a run and update them before they finish.",
  },
  // The markdown an account is made of opens as files, the way State does:
  // a tree to walk and the file beside it. The cards stay one link away.
  knowledge: {
    title: "Knowledge",
    blurb: "Reference material you give agents — specs, price lists, guidelines. Agents read it and never rewrite it.",
    empty: "Nothing in knowledge/ yet — add one with + New file.",
    list: "knowledge",
  },
  memory: {
    title: "Memory",
    blurb: "What past runs worked out, written by the agents themselves — the workspace's and each agent's own.",
    empty: "Agents write here as they learn — nothing yet.",
    list: "memory",
  },
  hooks: {
    title: "Hooks",
    blurb: "Your own code at the points every step passes through — one folder each, hook.md beside run.mjs. What they did lately is on the Hooks page.",
    empty: "No hooks in this workspace yet — foldrun hook add <name> --on tool.call makes one.",
  },
  skills: {
    title: "Skills",
    blurb: "Procedures an agent follows, one folder each with its SKILL.md.",
    empty: "No skills in this workspace yet.",
    list: "skills",
  },
};
// Knowledge, memory and skills live at the workspace root and inside each
// agent's folder; the scoped tree shows both, as the cards page does.
const AGENT_SCOPED = new Set(Object.keys(SCOPES).filter((k) => SCOPES[k].list));

function scopeOf(raw: string | undefined) {
  if (!raw || !(WORKSPACE_DIRS as readonly string[]).includes(raw)) return null;
  return { dir: raw, ...(SCOPES[raw] ?? { title: raw.charAt(0).toUpperCase() + raw.slice(1), blurb: `Everything under ${raw}/ in this workspace.` }) };
}

const KIND_LABEL: Record<FileKind, string> = {
  agent: "agent", flow: "flow", tool: "tool", skill: "skill", knowledge: "knowledge", memory: "memory",
  eval: "eval", state: "state", script: "script", config: "workspace", other: "file",
};

/** An agent, a flow or AGENTS.md reads its job blocks as flat keys — its
 *  `guardrail: {secrets}` are its secrets; any other file as written. */
function frontmatterOf(content: string, file: string): Record<string, unknown> {
  try {
    const kind = schemaKindOf(file);
    return ((kind === "agent" || kind === "flow" || kind === "agents-md" ? configMatter(content) : matter(content)).data ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ tenant?: string; path?: string; scope?: string }>;
}) {
  const { workspace } = await params;
  const { tenant = "default", path: filePath, scope: rawScope } = await searchParams;
  const dir = workspaceDir(tenant, workspace);
  if (!fs.existsSync(dir)) notFound();
  const now = nowMs();

  const scope = scopeOf(rawScope);
  const all = listWorkspaceFiles(tenant, workspace);
  const inScope = (f: string) =>
    !!scope && (f.startsWith(`${scope.dir}/`) || (AGENT_SCOPED.has(scope.dir) && new RegExp(`^agents/[^/]+/${scope.dir}/`).test(f)));
  const files = scope ? all.filter(inScope) : all;
  const selected =
    filePath && files.includes(filePath)
      ? filePath
      : (filePath && files.find((f) => f.startsWith(`${filePath}/`))) || files[0];
  let content: string | null = null;
  try {
    content = selected ? readWorkspaceFile(tenant, workspace, selected) : null;
  } catch {
    content = null;
  }
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";
  const linkSuffix = `${rest}${scope ? `&scope=${scope.dir}` : ""}`;
  const editHref = (p: string) => `/dashboard/${workspace}/edit?path=${encodeURIComponent(p)}${rest}`;

  // What the header and the panel say about this file.
  const kind: FileKind = selected ? kindOf(selected) : "other";
  const fm = content ? frontmatterOf(content, selected) : {};
  const chips = chipsFor(kind, fm);

  const sections: ContextSection[] = [];
  let issues: Issue[] = [];
  let test: { tool: string; transport: "http" | "script" | "mcp" | null; scriptArgs: string[] } | null = null;

  if (selected && content !== null) {
    const agents = listAgents(tenant, workspace);
    const flows = listFlows(tenant, workspace);
    const runs = listRuns(tenant, workspace);

    // The deploy checks, for this file only — the same ones a push runs, so a
    // missing `type:` shows here rather than in a refused deploy — and the
    // scanner's warnings about it (a key written in, hidden text), each
    // named by its rule so a foldrun-ignore can be written for it. Notes
    // stay on the Checks page.
    try {
      const own = deployIssues(checkTree(dir)).filter((i) => i.where === selected || i.where.startsWith(`${selected}:`) || i.where.startsWith(`${selected} `));
      const scanned = workspaceCheck(tenant, workspace)
        .filter((f) => f.file === selected && f.level !== "info" && !f.rule.endsWith("/config") && f.rule !== "knowledge/okf")
        .map((f) => ({ where: `${f.file}${f.line ? `:${f.line}` : ""}`, message: `${f.message} [${f.rule}]` }));
      issues = [...own, ...scanned];
    } catch {
      issues = [];
    }

    if (kind === "tool") {
      const toolName = typeof fm.name === "string" ? fm.name : selected.split("/").at(-2) ?? "";
      const users = agents.filter((a) => a.tools.includes(toolName));
      sections.push({
        title: "Used by",
        items: users.map((a) => ({ label: a.name, href: editHref(`agents/${a.name}/agent.md`), meta: a.model })),
        empty: `No agent grants ${toolName} yet — add it under tools: in an agent.`,
      });
      const transport = (typeof fm.transport === "string" ? fm.transport : typeof fm.type === "string" ? fm.type : null) as "http" | "script" | "mcp" | null;
      const defined = Object.keys(workspaceTools(tenant, workspace)).includes(toolName);
      if (defined && /(^|\/)tool\.md$|\.md$/.test(selected)) {
        test = { tool: toolName, transport, scriptArgs: fm.args && typeof fm.args === "object" ? Object.keys(fm.args as object) : [] };
      }
    }
    if (kind === "agent") {
      const agentName = selected.split("/")[1];
      const inFlows = flows.filter((f) => f.steps.some((s) => s.agent === agentName));
      sections.push({
        title: "Steps in",
        items: inFlows.map((f) => ({ label: f.name, href: editHref(`flows/${f.file}`), meta: f.trigger })),
        empty: "No flow steps this agent yet.",
      });
      const info = agents.find((a) => a.name === agentName);
      if (info) {
        sections.push({
          title: "Tools",
          items: info.tools.map((t) => ({ label: t, mono: true, ...(info.ownTools.includes(t) ? { href: `/dashboard/${workspace}/assets?kind=tools${rest}` } : { meta: "built-in", tone: "muted" as const }) })),
          empty: "No tools granted.",
        });
      }
      const own = runs.filter((r) => r.steps.some((s) => s.agent === agentName)).slice(0, 5);
      sections.push({
        title: "Recent runs",
        items: own.map((r) => ({ label: r.summary?.trim() || r.flow, href: `/dashboard/${workspace}/runs/${r.id}${rest.replace("&", "?")}`, meta: runDisplayStatus(r), tone: runDisplayStatus(r) === "failed" ? "error" : runDisplayStatus(r) === "completed" ? "ok" : "warn" })),
        empty: "This agent has not run yet.",
        more: { label: "All runs", href: `/dashboard/${workspace}/runs${qs}` },
      });
    }
    if (kind === "flow") {
      const flowName = typeof fm.name === "string" ? fm.name : path.basename(selected, ".md");
      const flow = flows.find((f) => f.name === flowName);
      sections.push({
        title: "Steps",
        items: (flow?.steps ?? []).map((s, i) => ({ label: `${i + 1}. ${s.agent}`, href: agents.some((a) => a.name === s.agent) ? editHref(`agents/${s.agent}/agent.md`) : undefined, tone: agents.some((a) => a.name === s.agent) ? undefined : ("error" as const), meta: agents.some((a) => a.name === s.agent) ? undefined : "missing" })),
        empty: "No steps yet — one [[agent]] per numbered line.",
      });
      const own = runs.filter((r) => r.flow === flowName).slice(0, 5);
      sections.push({
        title: "Recent runs",
        items: own.map((r) => ({ label: r.summary?.trim() || r.startedAt.slice(0, 16).replace("T", " "), href: `/dashboard/${workspace}/runs/${r.id}${rest.replace("&", "?")}`, meta: runDisplayStatus(r), tone: runDisplayStatus(r) === "failed" ? "error" : runDisplayStatus(r) === "completed" ? "ok" : "warn" })),
        empty: "This flow has not run yet.",
        more: { label: "All runs", href: `/dashboard/${workspace}/runs?flow=${encodeURIComponent(flowName)}${rest}` },
      });
    }
    if (kind === "skill") {
      const skillName = typeof fm.name === "string" ? fm.name : selected.split("/").at(-2) ?? "";
      const owner = selected.startsWith("agents/") ? selected.split("/")[1] : null;
      sections.push({
        title: "Loaded by",
        items: owner
          ? [{ label: owner, href: editHref(`agents/${owner}/agent.md`), meta: "its own" }]
          : agents.map((a) => ({ label: a.name, href: editHref(`agents/${a.name}/agent.md`) })),
        empty: `No agent loads ${skillName}.`,
      });
    }

    // Secrets the file names, and whether each is set — the one thing a
    // credential-shaped file cannot tell you by reading it.
    const refs = [...new Set([...secretRefs(content), ...(Array.isArray(fm.secrets) ? (fm.secrets as string[]) : [])])];
    if (refs.length > 0 || kind === "tool" || kind === "agent") {
      const set = new Set(listSecrets(tenant, workspace).map((s) => s.name));
      sections.push({
        title: "Secrets",
        items: refs.map((n) => ({ label: n, mono: true, meta: set.has(n) ? "set" : "missing", tone: set.has(n) ? ("ok" as const) : ("error" as const) })),
        empty: "Names none.",
        more: { label: "Secrets", href: `/dashboard/${workspace}/settings${qs}` },
      });
    }

    const revisions = listRevisions(tenant, workspace, { forPath: selected, limit: 5 });
    sections.push({
      title: "Changes",
      items: revisions.map((r) => ({ label: r.message || "(no message)", meta: `${r.by} · ${r.at.slice(0, 10)}`, href: `/dashboard/${workspace}/history?q=${encodeURIComponent(selected)}${rest}` })),
      empty: "No saved versions yet.",
      more: { label: "History", href: `/dashboard/${workspace}/history?q=${encodeURIComponent(selected)}${rest}` },
    });
    const doc = DOC_FOR[kind];
    if (doc) sections.push({ title: "Reference", items: [{ label: `How a ${KIND_LABEL[kind]} is written`, href: `/dashboard/docs/${doc}${qs}` }] });
  }

  const lastChange = selected ? listRevisions(tenant, workspace, { forPath: selected, limit: 1 })[0] ?? null : null;
  const crumbList = [
    { label: workspace, href: `/dashboard/${workspace}${qs}` },
    ...(selected ? crumbs(selected).map((c, i, arr) => (i < arr.length - 1 ? { label: c.label, href: `/dashboard/${workspace}/edit?path=${encodeURIComponent(c.prefix)}${rest}` } : { label: c.label })) : []),
  ];

  return (
    <EditorShell
      tenant={tenant}
      workspace={workspace}
      files={files}
      selected={selected}
      linkBase={`/dashboard/${workspace}/edit`}
      linkSuffix={linkSuffix}
      rootName={scope ? `${workspace}/${scope.dir}` : workspace}
      content={content}
      crumbs={crumbList}
      chips={chips}
      kindLabel={selected ? KIND_LABEL[kind] : "file"}
      issues={issues}
      lastChange={lastChange ? { by: lastChange.by, at: lastChange.at, href: `/dashboard/${workspace}/history${qs}` } : null}
      sections={sections}
      test={test}
      now={now}
      treeFooter={
        scope ? (
          <>
            {scope.list ? <NewFile workspace={workspace} tenant={tenant} scope={scope.dir} /> : null}
            {scope.list ? <p className="mt-2" /> : null}
            {scope.blurb}{" "}
            {scope.list ? (
              <>
                <Link href={`/dashboard/${workspace}/assets?kind=${scope.list}${rest}`} className="underline hover:text-fg-tertiary">See them as cards</Link>
                {" · "}
              </>
            ) : null}
            <Link href={`/dashboard/${workspace}/edit${qs}`} className="underline hover:text-fg-tertiary">Browse the whole workspace</Link>.
          </>
        ) : (
          <>
            <NewFile workspace={workspace} tenant={tenant} />
            <p className="mt-2">
              Runs, storage and secrets are not files here. Shared files live in the{" "}
              <Link href={`/dashboard/library/files${qs}`} className="underline hover:text-fg-tertiary">library</Link>.
            </p>
          </>
        )
      }
      emptyEditor={
        <EmptyScreen
          title={scope ? `Nothing in ${scope.dir}/ yet` : "No file selected"}
          description={scope ? (scope.empty ?? "Agents create these as they run — there is nothing to write by hand yet.") : "Pick a file from the tree, or create one."}
        />
      }
    />
  );
}
