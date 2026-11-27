// The workspace's files, in the editor shell: a tree with a filter, an
// editor with a header that says what the file is, and a panel with what
// it relates to — who uses it, the secrets it names, its runs, its recent
// changes, a test box for a tool. One directory can be scoped in (state/,
// from the sidebar), which narrows the tree and titles the page.

import { $t, localized } from "@/i18n";
import fs from "node:fs";
import path from "node:path";
import Link from "@foldrun/ui/react/link";
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
import { EmptyState, PageHeader } from "@foldrun/ui/react/page";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { buttonVariants } from "@foldrun/ui/react/button";
import { filesTabs } from "@/components/nav-model";
import { FileText, LayoutGrid, Library } from "lucide-react";
import { NewFile } from "./new-file";

import { requestLocale } from "@/server/locale";
export const dynamic = "force-dynamic";

const SCOPES: Record<string, { title: string; blurb: string; empty?: string; list?: string }> = localized(() => ({
  state: {
    title: $t("workspace.edit-page.state"),
    blurb: $t("workspace.edit-page.whatThisWorkspaceCarriesBetweenRuns"),
  },
  // The markdown an account is made of opens as files, the way State does:
  // a tree to walk and the file beside it. The cards stay one link away.
  knowledge: {
    title: $t("workspace.edit-page.knowledge"),
    blurb: $t("workspace.edit-page.referenceMaterialYouGiveAgentsSpecs"),
    empty: $t("workspace.edit-page.nothingInKnowledgeYetAddOne"),
    list: "knowledge",
  },
  memory: {
    title: $t("workspace.edit-page.memory"),
    blurb: $t("workspace.edit-page.whatPastRunsWorkedOutWritten"),
    empty: $t("workspace.edit-page.agentsWriteHereAsTheyLearn"),
    list: "memory",
  },
  hooks: {
    title: $t("workspace.edit-page.hooks"),
    blurb: $t("workspace.edit-page.yourOwnCodeAtThePoints"),
    empty: $t("workspace.edit-page.noHooksInThisWorkspaceYet"),
  },
  skills: {
    title: $t("workspace.edit-page.skills"),
    blurb: $t("workspace.edit-page.proceduresAnAgentFollowsOneFolder"),
    empty: $t("workspace.edit-page.noSkillsInThisWorkspaceYet"),
    list: "skills",
  },
}));
// Knowledge, memory and skills live at the workspace root and inside each
// agent's folder; the scoped tree shows both, as the cards page does.
const AGENT_SCOPED = new Set(Object.keys(SCOPES).filter((k) => SCOPES[k].list));

function scopeOf(raw: string | undefined) {
  if (!raw || !(WORKSPACE_DIRS as readonly string[]).includes(raw)) return null;
  return { dir: raw, ...(SCOPES[raw] ?? { title: raw.charAt(0).toUpperCase() + raw.slice(1), blurb: $t("workspace.edit-page.everythingUnderInThisWorkspace", { raw: String(raw) }) }) };
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
  await requestLocale();
  const { workspace } = await params;
  const { tenant = "default", path: filePath, scope: rawScope } = await searchParams;
  const dir = workspaceDir(tenant, workspace);
  if (!fs.existsSync(dir)) notFound();
  const now = nowMs();

  const scope = scopeOf(rawScope);
  const all = listWorkspaceFiles(tenant, workspace);
  const inScope = (f: string) =>
    !!scope && (f.startsWith(`${scope.dir}/`) || (AGENT_SCOPED.has(scope.dir) && new RegExp($t("workspace.edit-page.agents", { dir: String(scope.dir) })).test(f)));
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
        title: $t("workspace.edit-page.usedBy"),
        items: users.map((a) => ({ label: a.name, href: editHref(`agents/${a.name}/agent.md`), meta: a.model })),
        empty: $t("workspace.edit-page.noAgentGrantsYetAddIt", { toolName: String(toolName) }),
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
        title: $t("workspace.edit-page.stepsIn"),
        items: inFlows.map((f) => ({ label: f.name, href: editHref(`flows/${f.file}`), meta: f.trigger })),
        empty: $t("workspace.edit-page.noFlowStepsThisAgentYet"),
      });
      const info = agents.find((a) => a.name === agentName);
      if (info) {
        sections.push({
          title: $t("workspace.edit-page.tools"),
          items: info.tools.map((t) => ({ label: t, mono: true, ...(info.ownTools.includes(t) ? { href: `/dashboard/${workspace}/assets?kind=tools${rest}` } : { meta: "built-in", tone: "muted" as const }) })),
          empty: $t("workspace.edit-page.noToolsGranted"),
        });
      }
      const own = runs.filter((r) => r.steps.some((s) => s.agent === agentName)).slice(0, 5);
      sections.push({
        title: $t("workspace.edit-page.recentRuns"),
        items: own.map((r) => ({ label: r.summary?.trim() || r.flow, href: `/dashboard/${workspace}/runs/${r.id}${rest.replace("&", "?")}`, meta: runDisplayStatus(r), tone: runDisplayStatus(r) === "failed" ? "error" : runDisplayStatus(r) === "completed" ? "ok" : "warn" })),
        empty: $t("workspace.edit-page.thisAgentHasNotRunYet"),
        more: { label: $t("workspace.edit-page.allRuns"), href: `/dashboard/${workspace}/runs${qs}` },
      });
    }
    if (kind === "flow") {
      const flowName = typeof fm.name === "string" ? fm.name : path.basename(selected, ".md");
      const flow = flows.find((f) => f.name === flowName);
      sections.push({
        title: $t("workspace.edit-page.steps"),
        items: (flow?.steps ?? []).map((s, i) => ({ label: `${i + 1}. ${s.agent}`, href: agents.some((a) => a.name === s.agent) ? editHref(`agents/${s.agent}/agent.md`) : undefined, tone: agents.some((a) => a.name === s.agent) ? undefined : ("error" as const), meta: agents.some((a) => a.name === s.agent) ? undefined : "missing" })),
        empty: $t("workspace.edit-page.noStepsYetOneAgentPer"),
      });
      const own = runs.filter((r) => r.flow === flowName).slice(0, 5);
      sections.push({
        title: $t("workspace.edit-page.recentRuns"),
        items: own.map((r) => ({ label: r.summary?.trim() || r.startedAt.slice(0, 16).replace("T", " "), href: `/dashboard/${workspace}/runs/${r.id}${rest.replace("&", "?")}`, meta: runDisplayStatus(r), tone: runDisplayStatus(r) === "failed" ? "error" : runDisplayStatus(r) === "completed" ? "ok" : "warn" })),
        empty: $t("workspace.edit-page.thisFlowHasNotRunYet"),
        more: { label: $t("workspace.edit-page.allRuns"), href: `/dashboard/${workspace}/runs?flow=${encodeURIComponent(flowName)}${rest}` },
      });
    }
    if (kind === "skill") {
      const skillName = typeof fm.name === "string" ? fm.name : selected.split("/").at(-2) ?? "";
      const owner = selected.startsWith("agents/") ? selected.split("/")[1] : null;
      sections.push({
        title: $t("workspace.edit-page.loadedBy"),
        items: owner
          ? [{ label: owner, href: editHref(`agents/${owner}/agent.md`), meta: $t("workspace.edit-page.itsOwn") }]
          : agents.map((a) => ({ label: a.name, href: editHref(`agents/${a.name}/agent.md`) })),
        empty: $t("workspace.edit-page.noAgentLoads", { skillName: String(skillName) }),
      });
    }

    // Secrets the file names, and whether each is set — the one thing a
    // credential-shaped file cannot tell you by reading it.
    const refs = [...new Set([...secretRefs(content), ...(Array.isArray(fm.secrets) ? (fm.secrets as string[]) : [])])];
    if (refs.length > 0 || kind === "tool" || kind === "agent") {
      const set = new Set(listSecrets(tenant, workspace).map((s) => s.name));
      sections.push({
        title: $t("workspace.edit-page.secrets"),
        items: refs.map((n) => ({ label: n, mono: true, meta: set.has(n) ? "set" : "missing", tone: set.has(n) ? ("ok" as const) : ("error" as const) })),
        empty: $t("workspace.edit-page.namesNone"),
        more: { label: $t("workspace.edit-page.secrets"), href: `/dashboard/${workspace}/settings?tab=secrets${qs.replace("?", "&")}` },
      });
    }

    const revisions = await listRevisions(tenant, workspace, { forPath: selected, limit: 5 });
    sections.push({
      title: $t("workspace.edit-page.changes"),
      items: revisions.map((r) => ({ label: r.message || $t("workspace.edit-page.noMessage"), meta: `${r.by} · ${r.at.slice(0, 10)}`, href: `/dashboard/${workspace}/history?q=${encodeURIComponent(selected)}${rest}` })),
      empty: $t("workspace.edit-page.noSavedVersionsYet"),
      more: { label: $t("workspace.edit-page.history"), href: `/dashboard/${workspace}/history?q=${encodeURIComponent(selected)}${rest}` },
    });
    const doc = DOC_FOR[kind];
    if (doc) sections.push({ title: $t("workspace.edit-page.reference"), items: [{ label: $t("workspace.edit-page.howAIsWritten", { v0: String(KIND_LABEL[kind]) }), href: `/dashboard/docs/${doc}${qs}` }] });
  }

  const lastChange = selected ? ((await listRevisions(tenant, workspace, { forPath: selected, limit: 1 }))[0] ?? null) : null;
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
      header={
        <>
          <PageHeader
            title={scope ? scope.title : $t("workspace.edit-page.files")}
            description={scope ? scope.blurb : $t("workspace.edit-page.everythingThisWorkspaceIsMadeOf")}
            actions={
              scope?.list ? (
                <Link href={`/dashboard/${workspace}/assets?kind=${scope.list}${rest}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
                  <LayoutGrid />{" "}{$t("workspace.edit-page.viewAsCards")}
                </Link>
              ) : !scope ? (
                <Link href={`/dashboard/library/files${qs}`} className={buttonVariants({ variant: "secondary", size: "md" })}>
                  <Library />{" "}{$t("workspace.edit-page.sharedFiles")}
                </Link>
              ) : undefined
            }
            className="mb-6"
          />
          <PageTabs tabs={filesTabs(workspace, tenant)} />
        </>
      }
      treeFooter={scope ? (scope.list ? <NewFile workspace={workspace} tenant={tenant} scope={scope.dir} /> : undefined) : <NewFile workspace={workspace} tenant={tenant} />}
      emptyEditor={
        <EmptyState
          bare
          icon={<FileText />}
          title={scope ? $t("workspace.edit-page.nothingInYet", { dir: String(scope.dir) }) : $t("workspace.edit-page.noFileSelected")}
          description={scope ? (scope.empty ?? $t("workspace.edit-page.agentsCreateTheseAsTheyRun")) : $t("workspace.edit-page.pickAFileFromTheTree")}
        />
      }
    />
  );
}
