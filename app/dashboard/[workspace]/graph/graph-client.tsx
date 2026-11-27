"use client";

// The graph: a map of a workspace (or the whole account) — every workspace,
// flow, agent, tool, skill and file as a card, and the real relations
// between them as lines. Drawn with React Flow and a layout of our own
// (components/graph-layout-model.ts): columns by what a thing is, left to
// right, deterministic, so the same account always draws the same picture.
//
// Hover a card to light its neighbourhood; click it for its facts and links
// in the side panel; double-click to open it. The highlight is plain CSS
// keyed on node ids, so hovering a map of hundreds re-renders nothing.

import { $t, localized } from "@/i18n";
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@foldrun/ui/react/link";
import { usePathname, useRouter } from "next/navigation";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  ViewportPortal,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { DropdownMenu as M } from "radix-ui";
import {
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Building2,
  Check,
  Columns3,
  ExternalLink,
  FileText,
  ListFilter,
  Map as MapIcon,
  Maximize,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AgentInfo, AgentAssets, FlowInfo } from "@/lib/store";
import { FlowPanel } from "./flow-panel";
import { Button, buttonVariants } from "@foldrun/ui/react/button";
import { EmptyState, Page, PageHeader, IconBox } from "@foldrun/ui/react/page";
import { Segmented } from "@foldrun/ui/react/segmented";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, menuItemClass } from "@foldrun/ui/react/menu";
import { Status, StatusDot } from "@/components/status";
import { Kbd } from "@foldrun/ui/react/input";
import { SearchField } from "@foldrun/ui/react/list";
import { cn } from "@foldrun/ui/react/cn";
import { outcomeOf, type Outcome } from "@/components/outcome-model";
import { statsLine, fmtAgo, fmtCost } from "@/components/graph-stats-model";
import { idOf, isMajor, layoutGraph, workspaceOf, type LayoutName } from "@/components/graph-layout-model";

// The model lives in server/graph.ts so the account view draws with the same
// shapes rather than its own copy of them.
import type { Kind, Scope, GNode, GLink, Graph, SharedAssets } from "@/server/graph";
import { Tooltip } from "@foldrun/ui/react/tooltip";
export type { SharedAssets };

type AgentWithAssets = AgentInfo & { assets: AgentAssets };

// ---------------------------------------------------------------- words

const KIND_WORD: Record<Kind, string> = localized(() => ({
  agent: $t("workspace.graph-graph-client.agent"),
  flow: $t("workspace.graph-graph-client.flow"),
  tool: $t("workspace.graph-graph-client.tool"),
  skill: $t("workspace.graph-graph-client.skill"),
  knowledge: $t("workspace.graph-graph-client.knowledge"),
  memory: $t("workspace.graph-graph-client.memory"),
  scope: $t("workspace.graph-graph-client.workspace"),
}));

/** A kind's lucide icon — the only thing on a card that says what it is. */
function KindIcon({ kind, scope, className }: { kind: Kind; scope?: Scope; className?: string }) {
  const p = { className, "aria-hidden": true };
  switch (kind) {
    case "agent":
      return <Bot {...p} />;
    case "flow":
      return <Workflow {...p} />;
    case "tool":
      return <Wrench {...p} />;
    case "skill":
      return <BookOpen {...p} />;
    case "knowledge":
      return <FileText {...p} />;
    case "memory":
      return <Brain {...p} />;
    case "scope":
      return scope === "account" ? <Building2 {...p} /> : <Boxes {...p} />;
  }
}

type FilterKey = "scope" | "flow" | "agent" | "tool" | "skill" | "knowledge" | "memory";
const FILTERS: { key: FilterKey; label: string; icon: LucideIcon }[] = localized(() => [
  { key: "scope", label: $t("workspace.graph-graph-client.accountAndWorkspace"), icon: Boxes },
  { key: "flow", label: $t("workspace.graph-graph-client.flows"), icon: Workflow },
  { key: "agent", label: $t("workspace.graph-graph-client.agents"), icon: Bot },
  { key: "tool", label: $t("workspace.graph-graph-client.tools"), icon: Wrench },
  { key: "skill", label: $t("workspace.graph-graph-client.skills"), icon: BookOpen },
  { key: "knowledge", label: $t("workspace.graph-graph-client.knowledge"), icon: FileText },
  { key: "memory", label: $t("workspace.graph-graph-client.memory"), icon: Brain },
]);

/** A run status as the outcome model reads it. The graph's counters carry no
 *  verdict, so a completed run reads "done"; a step that never started has
 *  no outcome and draws no dot. */
function outcomeOfStatus(status: string): Outcome | null {
  return ["completed", "failed", "running", "awaiting-approval", "stopped", "queued"].includes(status) ? outcomeOf(status, null) : null;
}

/** How X relates to its neighbour across one link, from X's side. */
function relationWord(l: GLink, me: GNode, other: GNode): string {
  const out = idOf(l.source) === me.id;
  switch (l.kind) {
    case "owns":
      if (out) return me.kind === "flow" ? $t("workspace.graph-graph-client.steps") : $t("workspace.graph-graph-client.contains");
      return other.kind === "flow" ? $t("workspace.graph-graph-client.stepIn") : $t("workspace.graph-graph-client.belongsTo");
    case "use":
      return me.kind === "agent" ? $t("workspace.graph-graph-client.uses") : $t("workspace.graph-graph-client.usedBy");
    case "step":
      return out ? $t("workspace.graph-graph-client.handsOffTo") : $t("workspace.graph-graph-client.takesOverFrom");
    case "consult":
      return out ? $t("workspace.graph-graph-client.asks") : $t("workspace.graph-graph-client.askedBy");
    case "delegate":
      return out ? $t("workspace.graph-graph-client.delegatesTo") : $t("workspace.graph-graph-client.takesJobsFrom");
  }
}

// ---------------------------------------------------------------- nodes and edges

type CardData = {
  label: string;
  kind: Kind;
  scope?: Scope;
  meta: string;
  outcome: Outcome | null;
  title?: string;
};
type CardNode = Node<CardData, "card">;

type WireData = { kind: GLink["kind"]; sw: number; tw: number };
type WireEdge = Edge<WireData, "wire">;

// Room for the column headings above and the zoom bar below.
const FIT = { padding: { top: "48px", bottom: "64px", left: "24px", right: "24px" }, maxZoom: 1 } as const;

const HIDDEN_HANDLE = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, pointerEvents: "none" as const };

const Card = memo(function Card({ data }: NodeProps<CardNode>) {
  const major = isMajor(data.kind);
  return (
    <Tooltip label={data.title}>
    <div
      className={cn(
        "gcard flex h-full w-full items-center gap-2.5 rounded-lg border bg-surface px-2.5 shadow-xs transition-[border-color,box-shadow] duration-150",
        data.kind === "scope" ? "border-line-strong" : "border-line hover:border-line-strong",
      )}
    >
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} isConnectable={false} />
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
          major ? "size-8 border border-line bg-sunken text-fg-secondary" : "size-7 bg-sunken text-fg-muted",
        )}
      >
        <KindIcon kind={data.kind} scope={data.scope} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-medium text-fg">{data.label}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{data.meta}</span>
      </span>
      {data.outcome && <StatusDot outcome={data.outcome} className="mr-0.5" />}
    </div>
    </Tooltip>
  );
});

// One look for every line: a hairline grey. What kind of line it is shows in
// its dash, never in a colour — the colour on this page is run status alone.
const WIRE_STYLE: Record<GLink["kind"], React.CSSProperties> = {
  owns: { stroke: "var(--color-line-strong)", strokeWidth: 1.25 },
  use: { stroke: "var(--color-line-strong)", strokeWidth: 1.25, strokeDasharray: "5 4" },
  step: { stroke: "var(--color-line-strong)", strokeWidth: 1.5, strokeDasharray: "1.5 4", strokeLinecap: "round" },
  consult: { stroke: "var(--color-line-strong)", strokeWidth: 1.5, strokeDasharray: "1.5 4", strokeLinecap: "round" },
  delegate: { stroke: "var(--color-line-strong)", strokeWidth: 1.5, strokeDasharray: "1.5 4", strokeLinecap: "round" },
};

/** Left to right as a smooth curve; back to the left mirrored; within one
 *  column, an arc out to the right so it never runs through the cards. */
const Wire = memo(function Wire({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<WireEdge>) {
  const sw = data?.sw ?? 0;
  const tw = data?.tw ?? 0;
  const sLeft = sourceX - sw;
  const tRight = targetX + tw;
  let d: string;
  if (targetX >= sourceX + 8) {
    const c = Math.max(36, (targetX - sourceX) / 2);
    d = `M ${sourceX} ${sourceY} C ${sourceX + c} ${sourceY}, ${targetX - c} ${targetY}, ${targetX} ${targetY}`;
  } else if (tRight <= sLeft - 8) {
    const c = Math.max(36, (sLeft - tRight) / 2);
    d = `M ${sLeft} ${sourceY} C ${sLeft - c} ${sourceY}, ${tRight + c} ${targetY}, ${tRight} ${targetY}`;
  } else {
    const right = Math.max(sourceX, tRight);
    const bow = Math.min(84, 24 + Math.abs(targetY - sourceY) * 0.2);
    d = `M ${sourceX} ${sourceY} C ${right + bow} ${sourceY}, ${right + bow} ${targetY}, ${tRight} ${targetY}`;
  }
  return <BaseEdge id={id} path={d} style={WIRE_STYLE[data?.kind ?? "owns"]} interactionWidth={0} />;
});

const nodeTypes = { card: Card };
const edgeTypes = { wire: Wire };

// ---------------------------------------------------------------- the page

export function GraphClient(props: {
  /** Omitted in the account view, which spans every workspace. */
  workspace?: string;
  tenant: string;
  agents?: AgentWithAssets[];
  flows?: FlowInfo[];
  /**
   * The model, built on the server. Both views read the filesystem, which the
   * client cannot, so it receives the finished graph rather than ingredients —
   * and one builder draws both instead of the two that had drifted apart.
   */
  graph: Graph;
  title?: string;
  emptyMessage?: string;
  /** Map (columns by kind) or tree (containment), from `?layout=`. */
  layout?: LayoutName;
}) {
  return (
    <ReactFlowProvider>
      <GraphView {...props} />
    </ReactFlowProvider>
  );
}

function GraphView({
  workspace,
  tenant,
  agents = [],
  flows = [],
  graph,
  title,
  emptyMessage,
  layout: layoutName = "map",
}: React.ComponentProps<typeof GraphClient>) {
  const router = useRouter();
  const pathname = usePathname();
  const rf = useReactFlow<CardNode, WireEdge>();
  // The clock "3h ago" reads against: fixed when the page opened, because a
  // render must not consult the wall clock.
  const [openedAt] = useState(() => Date.now());
  const [hidden, setHidden] = useState<Set<FilterKey>>(() => new Set());
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The side panel: a card's facts, or the flow editor.
  const [panel, setPanel] = useState<null | "details" | "edit">(null);
  const [editFlow, setEditFlow] = useState<string | undefined>(undefined);
  const [minimap, setMinimap] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Stable short ids for React Flow (and the CSS that highlights by id):
  // graph ids hold colons, spaces and quotes.
  const rfId = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, `n${i}`])), [graph]);
  const byRf = useMemo(() => new Map(graph.nodes.map((n, i) => [`n${i}`, n])), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const counts = useMemo(() => {
    const c = new Map<FilterKey, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph]);

  // What is shown: the kinds the filter keeps, and the links between them.
  const view = useMemo(() => {
    const nodes = graph.nodes.filter((n) => !hidden.has(n.kind));
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.links.filter((l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target)));
    return { nodes, links };
  }, [graph, hidden]);

  const layout = useMemo(() => layoutGraph(layoutName, view.nodes, view.links), [layoutName, view]);

  // Every neighbour of every node, by relation — the panel's lists, the
  // cards' meta lines and the hover highlight all read it.
  const relations = useMemo(() => {
    const rel = new Map<string, Map<string, string[]>>();
    const add = (me: GNode, other: GNode, word: string) => {
      const m = rel.get(me.id) ?? rel.set(me.id, new Map()).get(me.id)!;
      const list = m.get(word) ?? m.set(word, []).get(word)!;
      if (!list.includes(other.id)) list.push(other.id);
    };
    for (const l of view.links) {
      const s = byId.get(idOf(l.source));
      const t = byId.get(idOf(l.target));
      if (!s || !t || s === t) continue;
      add(s, t, relationWord(l, s, t));
      add(t, s, relationWord(l, t, s));
    }
    return rel;
  }, [view, byId]);

  const metaOf = useCallback(
    (n: GNode): { meta: string; title?: string } => {
      const r = relations.get(n.id) ?? new Map<string, string[]>();
      const count = (word: string, kind?: Kind) => (r.get(word) ?? []).filter((id) => !kind || byId.get(id)?.kind === kind).length;
      const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
      const owner = () => {
        if (n.scope === "account") return "library";
        if (n.scope === "workspace") return workspace ? $t("common.workspaceOne") : (workspaceOf(n) ?? $t("common.workspaceOne"));
        return n.id.split(":")[2] ?? "agent";
      };
      const stats = n.stats;
      const ran = stats ? fmtAgo(openedAt - Date.parse(stats.lastAt)) : null;
      const title = stats ? $t("workspace.graph-graph-client.lastRunIn7Days", { label: String(n.label), last: String(stats.last), ran: String(ran), v3: String(statsLine(stats)) }) : undefined;
      const runLine = stats ? (stats.runs > 0 ? `${ran} · ${statsLine(stats)}` : `ran ${ran}`) : null;
      switch (n.kind) {
        case "scope":
          return n.scope === "account"
            ? { meta: $t("workspace.graph-graph-client.shared", { v0: String(plural(count("Contains", "scope"), $t("common.workspaceOne"), $t("common.workspaceOther"))), v1: String(count("Contains") - count("Contains", "scope")) }) }
            : { meta: `${plural(count("Contains", "agent"), "agent")} · ${plural(count("Contains", "flow"), "flow")}` };
        case "flow":
          return { meta: runLine ?? $t("workspace.graph-graph-client.neverRan", { v0: String(plural(count("Steps"), "step")) }), title };
        case "agent":
          return { meta: runLine ?? $t("workspace.graph-graph-client.neverRan", { v0: String(plural(count($t("workspace.graph-graph-client.stepIn")), "flow")) }), title };
        case "tool": {
          const users = count($t("workspace.graph-graph-client.usedBy"));
          return { meta: $t("workspace.graph-graph-client.tool2", { v0: String(owner()), v1: String(users > 1 ? $t("workspace.graph-graph-client.agents2", { users: String(users) }) : "") }) };
        }
        default:
          return { meta: `${KIND_WORD[n.kind]} · ${owner()}` };
      }
    },
    [relations, byId, openedAt, workspace],
  );

  const laidOut = useMemo<CardNode[]>(
    () =>
      view.nodes.map((n) => {
        const box = layout.pos.get(n.id)!;
        const { meta, title } = metaOf(n);
        return {
          id: rfId.get(n.id)!,
          type: "card",
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          data: { label: n.label, kind: n.kind, scope: n.scope, meta, title, outcome: n.stats ? outcomeOfStatus(n.stats.last) : null },
        };
      }),
    [view, layout, metaOf, rfId],
  );

  // Dragging moves a card for this look only; a new layout or filter starts
  // from the computed picture again (state derived from props, not an effect).
  const [nodes, setNodes] = useState<CardNode[]>(laidOut);
  const [basis, setBasis] = useState(laidOut);
  if (basis !== laidOut) {
    setBasis(laidOut);
    setNodes(laidOut);
  }
  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // The map leaves out the line from a workspace (or the account) to each of
  // its shared files: they would cross the whole picture, and the card's own
  // line already says where it lives. Hover still lights them.
  const edges = useMemo<WireEdge[]>(() => {
    const seen = new Set<string>();
    const out: WireEdge[] = [];
    for (const l of view.links) {
      const s = byId.get(idOf(l.source))!;
      const t = byId.get(idOf(l.target))!;
      if (layoutName === "map" && l.kind === "owns" && s.kind === "scope" && !isMajor(t.kind)) continue;
      // Packed into frames, a workspace's frame is its account's claim on it.
      if (layout.groups.length && l.kind === "owns" && s.kind === "scope" && t.kind === "scope") continue;
      const key = `${s.id}|${t.id}|${l.kind}`;
      if (seen.has(key) || s.id === t.id) continue;
      seen.add(key);
      out.push({
        id: `e${out.length}`,
        source: rfId.get(s.id)!,
        target: rfId.get(t.id)!,
        type: "wire",
        data: { kind: l.kind, sw: layout.pos.get(s.id)!.w, tw: layout.pos.get(t.id)!.w },
        selectable: false,
        focusable: false,
      });
    }
    return out;
  }, [view, byId, rfId, layout, layoutName]);

  const edgesOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges) {
      m.set(e.source, [...(m.get(e.source) ?? []), e.id]);
      m.set(e.target, [...(m.get(e.target) ?? []), e.id]);
    }
    return m;
  }, [edges]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? view.nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => rfId.get(n.id)!) : []),
    [q, view, rfId],
  );

  // ---- camera

  const fit = useCallback(() => {
    void rf.fitView({ ...FIT, duration: 300, minZoom: 0.1 });
  }, [rf]);

  const centreOn = useCallback(
    (id: string, keepZoom = false) => {
      const n = rf.getNode(id);
      if (!n) return;
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      requestAnimationFrame(() => {
        const zoom = keepZoom ? rf.getZoom() : Math.max(rf.getZoom(), 0.9);
        // On a phone the panel covers the lower part of the canvas: centre
        // the card in what is left above it.
        const phone = window.matchMedia($t("workspace.graph-graph-client.maxWidth767px")).matches;
        const shift = phone ? ((canvasRef.current?.clientHeight ?? 0) * 0.36) / zoom : 0;
        void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2 + shift, { zoom, duration: 350 });
      });
    },
    [rf],
  );

  const select = useCallback(
    (id: string | null, centre: false | "zoom" | "pan" = false) => {
      setSelected(id);
      setPanel(id ? "details" : null);
      // After the panel has opened, so the centre is the narrowed canvas's.
      if (id && centre) requestAnimationFrame(() => centreOn(id, centre === "pan"));
    },
    [centreOn],
  );

  // A new layout or filter: show the whole of it.
  const fitted = useRef(laidOut);
  useEffect(() => {
    if (fitted.current === laidOut) return; // the first picture is fitted by fitView
    fitted.current = laidOut;
    const t = requestAnimationFrame(() => fit());
    return () => cancelAnimationFrame(t);
  }, [laidOut, fit]);

  // Keyboard: + and − zoom, 0 fits, / finds, Esc closes the panel — when
  // nothing else has the keys (the flow editor keeps its own minus signs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") void rf.zoomIn({ duration: 200 });
      else if (e.key === "-" || e.key === "_") void rf.zoomOut({ duration: 200 });
      else if (e.key === "0") fit();
      else if (e.key === "/") searchRef.current?.focus();
      else if (e.key === "Escape") select(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf, fit, select]);

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      if (sel.length === 1) {
        setSelected(sel[0].id);
        setPanel((p) => (p === "edit" ? p : "details"));
      }
    },
    [],
  );

  // ---- the highlight, as CSS keyed on ids

  const highlight = useMemo(() => {
    const lit = hover ?? selected;
    const rules: string[] = [];
    const node = (id: string) => `.gmap .react-flow__node[data-id="${id}"]`;
    const edge = (id: string) => `.gmap .react-flow__edge[data-id="${id}"]`;
    if (lit && byRf.has(lit)) {
      const near = new Set<string>([lit]);
      for (const ids of (relations.get(byRf.get(lit)!.id) ?? new Map<string, string[]>()).values()) for (const id of ids) near.add(rfId.get(id)!);
      const lines = edgesOf.get(lit) ?? [];
      rules.push(`.gmap .react-flow__node{opacity:.3}`, `${[...near].map(node).join(",")}{opacity:1}`);
      rules.push(`.gmap .react-flow__edge{opacity:.2}`);
      if (lines.length) {
        rules.push(`${lines.map(edge).join(",")}{opacity:1}`);
        rules.push(`${lines.map((id) => `${edge(id)} path`).join(",")}{stroke:var(--color-fg-muted)!important;stroke-width:1.75px!important}`);
      }
    } else if (q) {
      rules.push(`.gmap .react-flow__node{opacity:.3}`, `.gmap .react-flow__edge{opacity:.2}`);
      if (matches.length) rules.push(`${matches.map(node).join(",")}{opacity:1}`, `${matches.map((id) => `${node(id)} .gcard`).join(",")}{border-color:var(--color-focus)}`);
    }
    if (selected) rules.push(`${node(selected)} .gcard{border-color:var(--color-focus);box-shadow:0 0 0 1px var(--color-focus),0 0 0 4px var(--color-focus-soft)}`);
    return rules.join("\n");
  }, [hover, selected, q, matches, byRf, relations, rfId, edgesOf]);

  // ---- the toolbar

  const tq = tenant !== "default" ? `tenant=${encodeURIComponent(tenant)}` : "";
  const layoutHref = (l: LayoutName) => {
    const qs = [l === "map" ? "" : `layout=${l}`, tq].filter(Boolean).join("&");
    return `${pathname}${qs ? `?${qs}` : ""}`;
  };
  const hiddenCount = hidden.size;

  const selectedNode = selected ? byRf.get(selected) : undefined;
  const isEmpty = graph.nodes.length === 0;

  const openEditor = (flow?: string) => {
    setEditFlow(flow);
    setPanel("edit");
  };

  const heading = workspace ? $t("workspace.graph-graph-client.graph") : `${(title ?? "account").charAt(0).toUpperCase()}${(title ?? "account").slice(1)} graph`;

  return (
    <Page width="full">
      <PageHeader
        title={heading}
        description={
          workspace
            ? $t("workspace.graph-graph-client.howThisWorkspaceSFlowsAgents")
            : $t("workspace.graph-graph-client.everyWorkspaceAgentFlowAndFile")
        }
        className="mb-5"
        actions={
          <>
            <form
              role="search"
              className="relative w-full sm:w-60"
              onSubmit={(e) => {
                e.preventDefault();
                if (matches[0]) select(matches[0], "zoom");
              }}
            >
              <SearchField inputRef={searchRef} size="md" value={query} onChange={setQuery} placeholder={$t("workspace.graph-graph-client.findACard")} autoFocusKey={false} note={q ? `${matches.length} found` : <Kbd>/</Kbd>} />
            </form>
            <Segmented
              label={$t("workspace.graph-graph-client.layout")}
              value={layoutName}
              items={[
                { key: "map", label: <><Columns3 className="size-4" aria-hidden />{$t("workspace.graph-graph-client.map")}</>, href: layoutHref("map") },
                { key: "tree", label: <><Network className="size-4" aria-hidden />{$t("workspace.graph-graph-client.tree")}</>, href: layoutHref("tree") },
              ]}
            />
            <Menu>
              <MenuTrigger asChild>
                <Button size="md" aria-label={$t("workspace.graph-graph-client.showOnTheGraph")}>
                  <ListFilter aria-hidden />
                  <span className="max-sm:sr-only">{hiddenCount ? $t("workspace.graph-graph-client.showOf", { v0: String(FILTERS.length - hiddenCount), length: String(FILTERS.length) }) : $t("workspace.graph-graph-client.show")}</span>
                </Button>
              </MenuTrigger>
              <MenuContent className="w-56">
                <MenuLabel>{$t("workspace.graph-graph-client.showOnTheGraph")}</MenuLabel>
                {FILTERS.map((f) => (
                  <M.CheckboxItem
                    key={f.key}
                    checked={!hidden.has(f.key)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (on) next.delete(f.key);
                        else next.add(f.key);
                        return next;
                      })
                    }
                    className={cn(menuItemClass, "pr-8")}
                  >
                    <f.icon aria-hidden />
                    {f.label}
                    <span className="ml-auto pl-3 text-xs tabular-nums text-fg-subtle">{counts.get(f.key) ?? 0}</span>
                    <M.ItemIndicator className="absolute right-2 inline-flex">
                      <Check />
                    </M.ItemIndicator>
                  </M.CheckboxItem>
                ))}
                <MenuSeparator />
                <MenuItem disabled={!hiddenCount} onSelect={() => setHidden(new Set())}>
                  {$t("workspace.graph-graph-client.showEverything")}
                </MenuItem>
              </MenuContent>
            </Menu>
            <Tooltip label={$t("workspace.graph-graph-client.fitEverythingInView0")}>
              <Button size="md" onClick={fit} className="max-sm:hidden">
                <Maximize aria-hidden />
                {$t("workspace.graph-graph-client.fit")}
              </Button>
            </Tooltip>
            {/* Editing a flow needs a workspace to write into. The account
                view spans many, so it shows the picture and links out. */}
            {workspace && (
              <Button size="md" onClick={() => (panel === "edit" ? setPanel(selected ? "details" : null) : openEditor(selectedNode?.kind === "flow" ? selectedNode.label : undefined))} aria-pressed={panel === "edit"}>
                <Workflow aria-hidden />
                {panel === "edit" ? $t("workspace.graph-graph-client.closeEditor") : $t("workspace.graph-graph-client.editFlow")}
              </Button>
            )}
          </>
        }
      />

      <div className="relative flex h-[calc(100svh-19rem)] min-h-[28rem] overflow-hidden rounded-lg border border-line bg-paper sm:h-[calc(100svh-15.5rem)]">
        <style>{`.gmap .react-flow__node,.gmap .react-flow__edge{transition:opacity .15s}\n${highlight}`}</style>
        <div ref={canvasRef} className="gmap relative min-w-0 flex-1">
          {isEmpty ? (
            <EmptyState
              bare
              className="h-full"
              icon={<Network />}
              title={$t("workspace.graph-graph-client.nothingToGraphYet")}
              description={emptyMessage ?? $t("workspace.graph-graph-client.addAnAgentToThisWorkspace")}
            />
          ) : (
            <ReactFlow<CardNode, WireEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, n) => select(n.id, "pan")}
              onNodeDoubleClick={(_, n) => {
                const g = byRf.get(n.id);
                const href = g && (g.href ?? linksFor(g, tenant)[0]?.href);
                if (href) router.push(href);
              }}
              onNodeMouseEnter={(_, n) => setHover(n.id)}
              onNodeMouseLeave={() => setHover(null)}
              onPaneClick={() => select(null)}
              onSelectionChange={onSelectionChange}
              selectNodesOnDrag={false}
              nodesConnectable={false}
              edgesFocusable={false}
              deleteKeyCode={null}
              // Off-screen culling only where it pays: a culled card is not
              // measured, and fitting would then miss it.
              onlyRenderVisibleElements={view.nodes.length > 400}
              fitView
              fitViewOptions={{ ...FIT, minZoom: 0.3 }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              aria-label={workspace ? $t("workspace.graph-graph-client.graphOf", { workspace: String(workspace) }) : $t("workspace.graph-graph-client.graphOfTheAccount")}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              {layout.groups.length > 0 && (
                <ViewportPortal>
                  {layout.groups.map((g) => (
                    <div
                      key={g.key}
                      style={{ position: "absolute", transform: $t("workspace.graph-graph-client.translatePxPx", { x: String(g.x), y: String(g.y) }), width: g.w, height: g.h }}
                      className="pointer-events-none rounded-xl border border-line"
                    >
                      <div className="flex h-9 items-center gap-2 border-b border-line-faint px-4 text-[13px] font-medium text-fg-secondary">
                        {g.key === "account" ? <Building2 className="size-4 text-fg-muted" aria-hidden /> : <Boxes className="size-4 text-fg-muted" aria-hidden />}
                        {g.label}
                      </div>
                    </div>
                  ))}
                </ViewportPortal>
              )}
              {layout.columns.length > 0 && (
                <ViewportPortal>
                  {layout.columns.map((c) => (
                    <div
                      key={c.key}
                      style={{ position: "absolute", transform: $t("workspace.graph-graph-client.translatePxPx2", { x: String(c.x), v1: String(layout.top - 36) }), width: c.w }}
                      className="pointer-events-none flex items-center gap-1.5 px-1 text-[13px] font-medium text-fg-secondary"
                    >
                      {c.label}
                      <span className="tabular-nums font-normal text-fg-subtle">{c.count}</span>
                    </div>
                  ))}
                </ViewportPortal>
              )}
              {!panel && (
                <Panel position="bottom-left" className="!m-3 max-xl:!hidden">
                  <Legend />
                </Panel>
              )}
              <Panel position="bottom-right" className="!m-3">
                <ZoomBar onFit={fit} onReset={() => { setNodes(laidOut); fit(); }} minimap={minimap} onMinimap={() => setMinimap((m) => !m)} />
              </Panel>
              {minimap && (
                <MiniMap
                  position="top-right"
                  pannable
                  zoomable
                  ariaLabel="Minimap"
                  className="!m-3 !h-[112px] !w-[176px] overflow-hidden rounded-md border border-line max-md:!hidden"
                  nodeColor="var(--color-line-strong)"
                  nodeStrokeWidth={0}
                  nodeBorderRadius={4}
                  maskColor="color-mix(in oklab, var(--color-gray-900) 6%, transparent)"
                />
              )}
            </ReactFlow>
          )}
        </div>

        {panel && (
          <aside
            aria-label={panel === "edit" ? $t("workspace.graph-graph-client.flowEditor") : $t("workspace.graph-graph-client.details")}
            className="z-10 flex flex-col overflow-hidden bg-surface max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[72%] max-md:rounded-t-lg max-md:border-t max-md:border-line max-md:shadow-overlay md:w-[22rem] md:shrink-0 md:border-l md:border-line"
          >
            {panel === "edit" && workspace ? (
              <>
                <PanelHead icon={<Workflow />} title={$t("workspace.graph-graph-client.editFlow")} sub={$t("workspace.graph-graph-client.reorderJoinOrDropStepsThen")} onClose={() => setPanel(selected ? "details" : null)} />
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <FlowPanel
                    key={editFlow ?? ""}
                    workspace={workspace}
                    tenant={tenant}
                    flows={flows}
                    agents={agents.map((a) => a.name)}
                    initial={editFlow}
                    onSaved={() => router.refresh()}
                  />
                </div>
              </>
            ) : selectedNode ? (
              <Details
                node={selectedNode}
                tenant={tenant}
                openedAt={openedAt}
                relations={relations.get(selectedNode.id)}
                byId={byId}
                onPick={(id) => select(rfId.get(id)!, "zoom")}
                onClose={() => select(null)}
                onEdit={workspace && selectedNode.kind === "flow" && flows.some((f) => f.name === selectedNode.label) ? () => openEditor(selectedNode.label) : undefined}
              />
            ) : null}
          </aside>
        )}
      </div>
      <p className="mt-3 px-1 text-[13px] text-fg-muted max-md:hidden">
        {$t("workspace.graph-graph-client.clickACardForItsDetails")}
      </p>
    </Page>
  );
}

// ---------------------------------------------------------------- parts

function Legend() {
  const kinds: [LucideIcon, string][] = [
    [Workflow, "Flow"],
    [Bot, "Agent"],
    [Wrench, "Tool"],
    [BookOpen, "Skill"],
    [Brain, "Memory"],
    [FileText, "Knowledge"],
  ];
  const line = (dash?: string) => (
    <svg width="22" height="6" aria-hidden className="shrink-0">
      <line x1="1" y1="3" x2="21" y2="3" stroke="var(--color-fg-subtle)" strokeWidth="1.5" strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
  return (
    <div className="flex items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-muted shadow-xs">
      {kinds.map(([Icon, word]) => (
        <span key={word} className="inline-flex items-center gap-1">
          <Icon className="size-3.5" aria-hidden />
          {word}
        </span>
      ))}
      <span className="h-3.5 w-px bg-line" aria-hidden />
      <span className="inline-flex items-center gap-1.5">{line()}{$t("workspace.graph-graph-client.contains2")}</span>
      <span className="inline-flex items-center gap-1.5">{line("5 4")}{$t("workspace.graph-graph-client.uses2")}</span>
      <span className="inline-flex items-center gap-1.5">{line("1.5 4")}{$t("workspace.graph-graph-client.handsOff")}</span>
    </div>
  );
}

function ZoomBar({ onFit, onReset, minimap, onMinimap }: { onFit: () => void; onReset: () => void; minimap: boolean; onMinimap: () => void }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 text-fg-secondary shadow-xs">
      <Tooltip label={$t("workspace.graph-graph-client.zoomOut")}>
        <Button size="icon-sm" variant="ghost" onClick={() => void rf.zoomOut({ duration: 200 })} aria-label={$t("workspace.graph-graph-client.zoomOut2")}>
          <Minus />
        </Button>
      </Tooltip>
      <Tooltip label={$t("workspace.graph-graph-client.fitEverythingInView0")}>
        <button type="button" onClick={onFit} className="h-8 min-w-[3.25rem] rounded-sm px-1 text-[13px] tabular-nums hover:bg-muted">
          {Math.round(zoom * 100)}%
        </button>
      </Tooltip>
      <Tooltip label={$t("workspace.graph-graph-client.zoomIn")}>
        <Button size="icon-sm" variant="ghost" onClick={() => void rf.zoomIn({ duration: 200 })} aria-label={$t("workspace.graph-graph-client.zoomIn2")}>
          <Plus />
        </Button>
      </Tooltip>
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <Tooltip label={$t("workspace.graph-graph-client.fitEverythingInView0")}>
        <Button size="icon-sm" variant="ghost" onClick={onFit} aria-label={$t("workspace.graph-graph-client.fit")}>
          <Maximize />
        </Button>
      </Tooltip>
      <Tooltip label={$t("workspace.graph-graph-client.putDraggedCardsBack")}>
        <Button size="icon-sm" variant="ghost" onClick={onReset} aria-label={$t("workspace.graph-graph-client.resetLayout")}>
          <RotateCcw />
        </Button>
      </Tooltip>
      <Tooltip label={minimap ? $t("workspace.graph-graph-client.hideTheMinimap") : $t("workspace.graph-graph-client.showTheMinimap")}>
        <Button size="icon-sm" variant="ghost" onClick={onMinimap} aria-pressed={minimap} aria-label={$t("workspace.graph-graph-client.minimap")} className="max-md:hidden aria-pressed:bg-muted aria-pressed:text-fg">
          <MapIcon />
        </Button>
      </Tooltip>
    </div>
  );
}

function PanelHead({ icon, title, sub, onClose }: { icon: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-4 py-3">
      <IconBox className="bg-sunken text-fg-secondary">{icon}</IconBox>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        {sub && <p className="truncate text-[13px] text-fg-muted">{sub}</p>}
      </div>
      <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={$t("workspace.graph-graph-client.closePanel")} className="-mr-1.5">
        <X />
      </Button>
    </div>
  );
}

/** Where a card leads: its own page, its file, the place its kind is kept. */
function linksFor(n: GNode, tenant: string): { label: string; href: string }[] {
  const q = tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : "";
  const qa = tenant !== "default" ? `&tenant=${encodeURIComponent(tenant)}` : "";
  const ws = workspaceOf(n);
  const plural = n.kind === "skill" ? "skills" : n.kind === "tool" ? "tools" : n.kind;
  const out: { label: string; href: string }[] = [];
  switch (n.kind) {
    case "scope":
      if (n.scope === "account") out.push({ label: $t("workspace.graph-graph-client.openLibrary"), href: `/dashboard/library${q}` });
      else if (n.href) out.push({ label: $t("workspace.graph-graph-client.openWorkspace"), href: n.href });
      break;
    case "agent":
      if (ws) out.push({ label: $t("workspace.graph-graph-client.openAgent"), href: `/dashboard/${ws}/agents/${encodeURIComponent(n.label)}${q}` });
      if (n.href) out.push({ label: $t("workspace.graph-graph-client.openFile"), href: n.href });
      break;
    case "flow":
      if (ws) out.push({ label: $t("workspace.graph-graph-client.openFlow"), href: `/dashboard/${ws}/flows?flow=${encodeURIComponent(n.label)}${qa}` });
      if (n.href) out.push({ label: $t("workspace.graph-graph-client.openFile"), href: n.href });
      break;
    case "tool":
      if (n.scope === "account") out.push({ label: $t("workspace.graph-graph-client.openInLibrary"), href: `/dashboard/library?kind=tools${qa}` });
      else if (n.scope === "workspace" && ws) out.push({ label: $t("workspace.graph-graph-client.openInTools"), href: `/dashboard/${ws}/assets?kind=tools${qa}` });
      break;
    default:
      if (n.scope === "account") out.push({ label: $t("workspace.graph-graph-client.openInLibrary"), href: `/dashboard/library?kind=${plural}${qa}` });
      else if (ws) out.push({ label: $t("workspace.graph-graph-client.openInFiles"), href: `/dashboard/${ws}/edit?scope=${plural}${qa}` });
  }
  return out;
}

const SCOPE_WORD: Record<Scope, string> = localized(() => ({ account: $t("workspace.graph-graph-client.accountLibrary"), workspace: $t("workspace.graph-graph-client.workspace"), agent: $t("workspace.graph-graph-client.agentSOwn") }));

function Details({
  node,
  tenant,
  openedAt,
  relations,
  byId,
  onPick,
  onClose,
  onEdit,
}: {
  node: GNode;
  tenant: string;
  openedAt: number;
  relations?: Map<string, string[]>;
  byId: Map<string, GNode>;
  onPick: (id: string) => void;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const stats = node.stats;
  const outcome = stats ? outcomeOfStatus(stats.last) : null;
  const ws = workspaceOf(node);
  const kindWord = node.kind === "scope" ? (node.scope === "account" ? $t("workspace.graph-graph-client.account") : $t("workspace.graph-graph-client.workspace")) : KIND_WORD[node.kind];
  const asset = !isMajor(node.kind);
  const sub = [kindWord, asset && node.scope ? SCOPE_WORD[node.scope] : null, node.kind !== "scope" && ws ? ws : null].filter(Boolean).join(" · ");
  const links = linksFor(node, tenant);
  return (
    <>
      <PanelHead icon={<KindIcon kind={node.kind} scope={node.scope} />} title={node.label} sub={sub} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {stats && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <div>
              <dt className="text-fg-muted">{$t("workspace.graph-graph-client.lastRun")}</dt>
              <dd className="mt-0.5">{outcome ? <Status outcome={outcome} /> : <span className="text-fg-secondary">{stats.last}</span>}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{$t("workspace.graph-graph-client.started")}</dt>
              <dd className="mt-0.5 text-fg-secondary">{fmtAgo(openedAt - Date.parse(stats.lastAt))}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{$t("workspace.graph-graph-client.runs7Days")}</dt>
              <dd className="mt-0.5 tabular-nums text-fg">{stats.runs}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{$t("workspace.graph-graph-client.spend7Days")}</dt>
              <dd className="mt-0.5 tabular-nums text-fg">{fmtCost(stats.cost)}</dd>
            </div>
          </dl>
        )}

        {(links.length > 0 || onEdit) && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={buttonVariants({ size: "sm" })}>
                {l.label}
                <ExternalLink className="size-3.5 text-fg-muted" aria-hidden />
              </Link>
            ))}
            {onEdit && (
              <Button size="sm" onClick={onEdit}>
                <Workflow aria-hidden />
                {$t("workspace.graph-graph-client.editSteps")}
              </Button>
            )}
          </div>
        )}

        {relations && relations.size > 0 ? (
          [...relations].map(([word, ids]) => (
            <section key={word}>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-fg-secondary">
                {word}
                <span className="font-normal tabular-nums text-fg-subtle">{ids.length}</span>
              </h3>
              <ul className="overflow-hidden rounded-md border border-line">
                {ids.map((id) => {
                  const n = byId.get(id);
                  if (!n) return null;
                  const o = n.stats ? outcomeOfStatus(n.stats.last) : null;
                  return (
                    <li key={id} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onPick(id)}
                        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
                      >
                        <KindIcon kind={n.kind} scope={n.scope} className="size-4 shrink-0 text-fg-muted" />
                        <span className="min-w-0 flex-1 truncate text-fg">{n.label}</span>
                        <span className="shrink-0 text-xs text-fg-subtle">{n.kind === "scope" ? (n.scope === "account" ? "account" : $t("common.workspaceOne")) : n.kind}</span>
                        {o && <StatusDot outcome={o} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : (
          <p className="text-[13px] text-fg-muted">{$t("workspace.graph-graph-client.nothingConnectsToThisYet")}</p>
        )}
      </div>
    </>
  );
}
