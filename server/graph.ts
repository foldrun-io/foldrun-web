// The graph model, shared by the workspace view and the account view.
//
// One renderer draws both, so the shapes it draws live here rather than inside
// the client component — otherwise the account view would need its own copy of
// GNode and GLink, which is how two graphs start disagreeing about what a
// "scope" is.
//
// The two views answer different questions:
//
//   workspace   how does work flow *here* — flows, their steps, who hands to
//               whom. Bounded and legible because a workspace is bounded.
//
//   account     the whole picture: every workspace, every agent, every flow
//               and every shared file, plus the edges that cross a workspace
//               boundary. Only one kind of edge does: an agent opting into a
//               library tool with `tools:`. That is the entire reason a library
//               exists, and until now nothing drew it.

import { scopeAllows } from "@/platform/scope";
import { listWorkspaces, listAgents, listFlows, agentAssets, workspaceTools, workspaceDir, listRuns, listAllRuns } from "@/lib/store";
import { nodeStats, attachStats, type NodeStats } from "@/components/graph-stats-model";
import { libraryDir, libraryTools, libraryUsage, listLibrary, LIBRARY_KINDS } from "@/lib/library";
import { readBundle } from "@/lib/okf";
import { discoverSkills } from "@/lib/runner";
import path from "node:path";

// Scope is a *kind*, not something you infer from position: an account skill
// and an agent's own skill used to draw identically, which hid the one
// relationship the graph exists to show.
export type Kind = "agent" | "flow" | "skill" | "memory" | "knowledge" | "tool" | "scope";
export type Scope = "account" | "workspace" | "agent";

export interface SharedAssets {
  skills: string[];
  knowledge: string[];
  memory: string[];
  tools: string[];
}

export interface GNode {
  /** Which level this lives at — the graph colours by this. */
  scope?: Scope;
  id: string;
  kind: Kind;
  label: string;
  href?: string;
  degree: number;
  /** Run counters, on agents and flows that have run: how the last run
   *  ended, runs and spend in the window. Absent where nothing ran, so the
   *  renderer draws nothing rather than a zero. */
  stats?: NodeStats;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GLink {
  source: string | GNode;
  target: string | GNode;
  /**
   * step      one agent hands work to the next, within a flow
   * owns      containment — a scope holds a thing, a flow names a step
   * use       an agent opted into a shared tool. The only edge that crosses a
   *           workspace boundary, and the reason the account view connects.
   */
  kind: "step" | "owns" | "use" | "consult" | "delegate";
}

export interface Graph {
  nodes: GNode[];
  links: GLink[];
}

/** Degree drives dot size, so it is counted once here for whatever built the graph. */
export function withDegrees(nodes: GNode[], links: GLink[]): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    const s = byId.get(l.source as string);
    const t = byId.get(l.target as string);
    if (s) s.degree += 1;
    if (t) t.degree += 1;
  }
  return { nodes, links };
}

/**
 * Everything in one account.
 *
 * Reads the filesystem, so it runs on the server and hands the client plain
 * data. Node ids are namespaced by workspace — two workspaces may both have an
 * agent called `writer`, and merging them into one dot would invent a
 * relationship that does not exist.
 */
/**
 * Everything in one workspace, added to a graph in progress.
 *
 * Both views draw the same workspace the same way — this is that drawing, once.
 * It was two copies: the client component built the workspace view and this
 * module rebuilt the identical agent/flow/step logic for the account view.
 *
 * Ids are always namespaced by workspace, even in the single-workspace view
 * where nothing could collide. Two workspaces may both have an agent called
 * `writer`, and one id scheme that is always right beats two that are each
 * right in one place.
 */
function addWorkspace(
  tenant: string,
  name: string,
  push: (n: Omit<GNode, "degree">) => void,
  links: GLink[],
  has: (id: string) => boolean,
) {
  const q = tenant !== "default" ? `?tenant=${tenant}` : "";
  const qs = tenant !== "default" ? `&tenant=${tenant}` : "";
  const wsId = `scope:${name}`;
  push({ id: wsId, kind: "scope", label: name, scope: "workspace", href: `/dashboard/${name}${q}` });

  const dir = workspaceDir(tenant, name);
  const assets: SharedAssets = {
    skills: discoverSkills(dir).map((s) => s.name),
    knowledge: readBundle(path.join(dir, "knowledge")).map((d) => d.title),
    memory: readBundle(path.join(dir, "memory")).map((d) => d.title),
    tools: Object.keys(workspaceTools(tenant, name)),
  };
  for (const [kind, list] of [
    ["skill", assets.skills], ["knowledge", assets.knowledge],
    ["memory", assets.memory], ["tool", assets.tools],
  ] as const) {
    for (const label of list) {
      const id = `${kind}:${name}:${label}`;
      push({ id, kind, label, scope: "workspace" });
      links.push({ source: wsId, target: id, kind: "owns" });
    }
  }

  const agents = listAgents(tenant, name).map((a) => ({
    ...a,
    assets: agentAssets(tenant, name, a.name),
  }));
  for (const a of agents) {
    const id = `agent:${name}:${a.name}`;
    push({
      id,
      kind: "agent",
      label: a.name,
      scope: "agent",
      href: `/dashboard/${name}/edit?path=${encodeURIComponent(`agents/${a.name}/agent.md`)}${qs}`,
    });
    links.push({ source: wsId, target: id, kind: "owns" });
    for (const s of a.assets.skills) {
      const sid = `skill:${name}:${a.name}:${s}`;
      push({ id: sid, kind: "skill", label: s, scope: "agent" });
      links.push({ source: id, target: sid, kind: "owns" });
    }
    for (const m of a.assets.memory) {
      const mid = `mem:${name}:${a.name}:${m}`;
      push({ id: mid, kind: "memory", label: m, scope: "agent" });
      links.push({ source: id, target: mid, kind: "owns" });
    }
    // What this agent can actually DO — the edges the graph exists for.
    // Workspace tools were drawn as children of the workspace and never
    // connected to the agents using them, so the picture showed a toolbox
    // and a team and no relationship between them.
    for (const u of a.ownTools) {
      const wsTool = `tool:${name}:${u}`;
      // A workspace tool wins over a library one of the same name, matching
      // the runner's own resolution; account-tool edges are addUseEdges'
      // job, and drawing them here too would double every one.
      if (has(wsTool)) links.push({ source: id, target: wsTool, kind: "use" });
    }
    // Whatever is left of `tools:` after the real files have claimed their
    // own nodes: the built-in kit — read, write, code, search — which
    // has no file to hang off and would otherwise leave an agent looking as
    // though it could do nothing.
    //
    // The filter is the point. `tools:` is the GRANT list, not a list of
    // tools defined inline, so drawing all of it here drew a second copy of
    // every tool that already had one: the workspace's, linked from
    // ownTools just above, and the account library's, linked by
    // addUseEdges. An agent granted its own workspace tool showed that tool
    // twice, which reads as a misconfiguration the author cannot find
    // because it is not in their file.
    for (const t of a.tools) {
      if (has(`tool:${name}:${t}`) || has(`tool:account:${t}`)) continue;
      const tid = `tool:${name}:${a.name}:${t}`;
      push({ id: tid, kind: "tool", label: t, scope: "agent" });
      links.push({ source: id, target: tid, kind: "use" });
    }
  }

  // Who may ask whom. `agents:` is the only agent-to-agent edge an author
  // draws by hand, and the graph drew everything BUT it — a team picture
  // with no relationships between the people in it. A second pass, because
  // a colleague later in the list has no node yet during the first; a
  // dangling name is left undrawn and reported by `check` instead.
  const agentNames = new Set(agents.map((a) => a.name));
  for (const a of agents) {
    for (const c of a.consults) {
      if (c === a.name || !agentNames.has(c)) continue;
      links.push({ source: `agent:${name}:${a.name}`, target: `agent:${name}:${c}`, kind: "consult" });
    }
    // `subagents:` — whom it may hand a whole job to (own context, own
    // tools). The heavier edge: a delegate does work, a consult only answers.
    for (const c of a.subagents ?? []) {
      if (c === a.name || !agentNames.has(c)) continue;
      links.push({ source: `agent:${name}:${a.name}`, target: `agent:${name}:${c}`, kind: "delegate" });
    }
  }

  const flows = listFlows(tenant, name);
  const flowNames = new Set(flows.map((f) => f.name));
  for (const f of flows) {
    const fid = `flow:${name}:${f.name}`;
    push({
      id: fid,
      kind: "flow",
      label: f.name,
      scope: "workspace",
      href: `/dashboard/${name}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${qs}`,
    });
    // The workspace owns its flows, said as an edge. Without it a flow with
    // no resolvable steps floated as an isolated dot, and the hierarchy view
    // had no branch to hang flows from. Pushed before the step edges, so it
    // is the flow's *first* owner — which is what the tree layout keys on.
    links.push({ source: wsId, target: fid, kind: "owns" });
    // A step may name another flow (`[[flow:weekly]]`) instead of an agent —
    // reading only s.agent dropped those steps, so a flow built out of flows
    // drew as an isolated node. A target that doesn't exist is skipped rather
    // than invented; `check` is what reports a dangling reference.
    const groups = new Map<number, string[]>();
    for (const s of f.steps) {
      const target = s.subflow ? `flow:${name}:${s.subflow}` : `agent:${name}:${s.agent}`;
      if (!(s.subflow ? flowNames.has(s.subflow) : has(target))) continue;
      groups.set(s.group, [...(groups.get(s.group) ?? []), target]);
      links.push({ source: fid, target, kind: "owns" });
    }
    const ordered = [...groups.entries()].sort(([a], [b]) => a - b).map(([, g]) => g);
    for (let i = 1; i < ordered.length; i++) {
      for (const from of ordered[i - 1]) for (const to of ordered[i]) {
        links.push({ source: from, target: to, kind: "step" });
      }
    }
  }
}

/** One workspace: how work flows here. Bounded, which is what keeps it legible. */
export function buildWorkspaceGraph(tenant: string, workspace: string): Graph {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const seen = new Set<string>();
  const push = (n: Omit<GNode, "degree">) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push({ ...n, degree: 0 });
  };

  // The account still appears, with what it shares — without it the picture
  // implied agents were isolated, hiding the one relationship worth seeing.
  push({ id: "scope:account", kind: "scope", label: "account", scope: "account" });
  addLibrary(tenant, push, links);
  addWorkspace(tenant, workspace, push, links, (id) => seen.has(id));
  links.push({ source: "scope:account", target: `scope:${workspace}`, kind: "owns" });
  addUseEdges(tenant, links, (id) => seen.has(id));

  attachStats(nodes, nodeStats(listRuns(tenant, workspace).map((r) => ({ ...r, workspace })), Date.now()));
  return withDegrees(nodes, links);
}

/** The account library's own nodes, hung off the account rather than off every
 *  agent that can see them — forty agents to nine files is a hairball. */
function addLibrary(
  tenant: string,
  push: (n: Omit<GNode, "degree">) => void,
  links: GLink[],
) {
  const library: SharedAssets = {
    skills: discoverSkills(libraryDir(tenant)).map((s) => s.name),
    knowledge: readBundle(libraryDir(tenant, "knowledge")).map((d) => d.title),
    memory: readBundle(libraryDir(tenant, "memory")).map((d) => d.title),
    tools: Object.keys(libraryTools(tenant)),
  };
  for (const [kind, list] of [
    ["skill", library.skills], ["knowledge", library.knowledge],
    ["memory", library.memory], ["tool", library.tools],
  ] as const) {
    for (const label of list) {
      const id = `${kind}:account:${label}`;
      push({ id, kind, label, scope: "account" });
      links.push({ source: "scope:account", target: id, kind: "owns" });
    }
  }
}

/** A `tools:` grant of a library tool — the only edge that crosses a workspace boundary, and the entire
 *  reason an account library exists. */
function addUseEdges(tenant: string, links: GLink[], has: (id: string) => boolean) {
  for (const kind of LIBRARY_KINDS) {
    if (kind === "scripts") continue; // code, not a node
    for (const entry of listLibrary(tenant, kind)) {
      const assetId = `${kind === "tools" ? "tool" : kind === "skills" ? "skill" : kind}:account:${entry.name}`;
      if (!has(assetId)) continue;
      for (const u of libraryUsage(tenant, kind, entry.name)) {
        if (u.relation !== "use" || !u.agent) continue;
        const consumer = `agent:${u.workspace}:${u.agent}`;
        if (has(consumer)) links.push({ source: assetId, target: consumer, kind: "use" });
      }
    }
  }
}

/** `scope`: the workspaces the viewer may see, or null for all — the
 *  account graph is the one place every workspace's shape is drawn on one
 *  canvas, which is exactly the view a scoped member must not get. */
export function buildAccountGraph(tenant: string, scope: string[] | null = null): Graph {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const seen = new Set<string>();
  const push = (n: Omit<GNode, "degree">) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push({ ...n, degree: 0 });
  };
  const has = (id: string) => seen.has(id);

  push({ id: "scope:account", kind: "scope", label: "account", scope: "account" });
  addLibrary(tenant, push, links);

  const visible = listWorkspaces(tenant).filter((w) => scopeAllows(scope, w.name));
  for (const ws of visible) {
    addWorkspace(tenant, ws.name, push, links, has);
    links.push({ source: "scope:account", target: `scope:${ws.name}`, kind: "owns" });
  }

  addUseEdges(tenant, links, has);
  attachStats(nodes, nodeStats(listAllRuns(tenant).filter((r) => scopeAllows(scope, r.workspace)), Date.now()));
  return withDegrees(nodes, links);
}
