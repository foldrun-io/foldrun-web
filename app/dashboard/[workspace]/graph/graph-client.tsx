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

import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { Button, buttonVariants } from "@/components/kit/button";
import { EmptyState, Page, PageHeader, IconBox } from "@/components/kit/page";
import { Segmented } from "@/components/kit/segmented";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, menuItemClass } from "@/components/kit/menu";
import { Status, StatusDot } from "@/components/kit/status";
import { Kbd } from "@/components/kit/input";
import { SearchField } from "@/components/kit/list";
import { cn } from "@/components/kit/cn";
import { outcomeOf, type Outcome } from "@/components/outcome-model";
import { statsLine, fmtAgo, fmtCost } from "@/components/graph-stats-model";
import { idOf, isMajor, layoutGraph, workspaceOf, type LayoutName } from "@/components/graph-layout-model";

// The model lives in server/graph.ts so the account view draws with the same
// shapes rather than its own copy of them.
import type { Kind, Scope, GNode, GLink, Graph, SharedAssets } from "@/server/graph";
import { Tooltip } from "@/components/kit/tooltip";
export type { SharedAssets };

type AgentWithAssets = AgentInfo & { assets: AgentAssets };

// ---------------------------------------------------------------- words

const KIND_WORD: Record<Kind, string> = {
  agent: "Agent",
  flow: "Flow",
  tool: "Tool",
  skill: "Skill",
  knowledge: "Knowledge",
  memory: "Memory",
  scope: "Workspace",
};

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
const FILTERS: { key: FilterKey; label: string; icon: LucideIcon }[] = [
  { key: "scope", label: "Account and workspaces", icon: Boxes },
  { key: "flow", label: "Flows", icon: Workflow },
  { key: "agent", label: "Agents", icon: Bot },
  { key: "tool", label: "Tools", icon: Wrench },
  { key: "skill", label: "Skills", icon: BookOpen },
  { key: "knowledge", label: "Knowledge", icon: FileText },
  { key: "memory", label: "Memory", icon: Brain },
];

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
      if (out) return me.kind === "flow" ? "Steps" : "Contains";
      return other.kind === "flow" ? "Step in" : "Belongs to";
    case "use":
      return me.kind === "agent" ? "Uses" : "Used by";
    case "step":
      return out ? "Hands off to" : "Takes over from";
    case "consult":
      return out ? "Asks" : "Asked by";
    case "delegate":
      return out ? "Delegates to" : "Takes jobs from";
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
        if (n.scope === "workspace") return workspace ? "workspace" : (workspaceOf(n) ?? "workspace");
        return n.id.split(":")[2] ?? "agent";
      };
      const stats = n.stats;
      const ran = stats ? fmtAgo(openedAt - Date.parse(stats.lastAt)) : null;
      const title = stats ? `${n.label} — last run ${stats.last}, ${ran} · ${statsLine(stats)} in 7 days` : undefined;
      const runLine = stats ? (stats.runs > 0 ? `${ran} · ${statsLine(stats)}` : `ran ${ran}`) : null;
      switch (n.kind) {
        case "scope":
          return n.scope === "account"
            ? { meta: `${plural(count("Contains", "scope"), "workspace")} · ${count("Contains") - count("Contains", "scope")} shared` }
            : { meta: `${plural(count("Contains", "agent"), "agent")} · ${plural(count("Contains", "flow"), "flow")}` };
        case "flow":
          return { meta: runLine ?? `${plural(count("Steps"), "step")} · never ran`, title };
        case "agent":
          return { meta: runLine ?? `${plural(count("Step in"), "flow")} · never ran`, title };
        case "tool": {
          const users = count("Used by");
          return { meta: `Tool · ${owner()}${users > 1 ? ` · ${users} agents` : ""}` };
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
        const phone = window.matchMedia("(max-width: 767px)").matches;
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

  const heading = workspace ? "Graph" : `${(title ?? "account").charAt(0).toUpperCase()}${(title ?? "account").slice(1)} graph`;

  return (
    <Page width="full">
      <PageHeader
        title={heading}
        description={
          workspace
            ? "How this workspace's flows, agents, tools and files connect."
            : "Every workspace, agent, flow and file, and what is shared across them."
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
              <SearchField inputRef={searchRef} size="md" value={query} onChange={setQuery} placeholder="Find a card…" autoFocusKey={false} note={q ? `${matches.length} found` : <Kbd>/</Kbd>} />
            </form>
            <Segmented
              label="Layout"
              value={layoutName}
              items={[
                { key: "map", label: <><Columns3 className="size-4" aria-hidden />Map</>, href: layoutHref("map") },
                { key: "tree", label: <><Network className="size-4" aria-hidden />Tree</>, href: layoutHref("tree") },
              ]}
            />
            <Menu>
              <MenuTrigger asChild>
                <Button size="md" aria-label="Show on the graph">
                  <ListFilter aria-hidden />
                  <span className="max-sm:sr-only">{hiddenCount ? `Show · ${FILTERS.length - hiddenCount} of ${FILTERS.length}` : "Show"}</span>
                </Button>
              </MenuTrigger>
              <MenuContent className="w-56">
                <MenuLabel>Show on the graph</MenuLabel>
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
                  Show everything
                </MenuItem>
              </MenuContent>
            </Menu>
            <Tooltip label="Fit everything in view (0)">
              <Button size="md" onClick={fit} className="max-sm:hidden">
                <Maximize aria-hidden />
                Fit
              </Button>
            </Tooltip>
            {/* Editing a flow needs a workspace to write into. The account
                view spans many, so it shows the picture and links out. */}
            {workspace && (
              <Button size="md" onClick={() => (panel === "edit" ? setPanel(selected ? "details" : null) : openEditor(selectedNode?.kind === "flow" ? selectedNode.label : undefined))} aria-pressed={panel === "edit"}>
                <Workflow aria-hidden />
                {panel === "edit" ? "Close editor" : "Edit flow"}
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
              title="Nothing to graph yet"
              description={emptyMessage ?? "Add an agent to this workspace and it appears here."}
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
              aria-label={workspace ? `Graph of ${workspace}` : "Graph of the account"}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              {layout.groups.length > 0 && (
                <ViewportPortal>
                  {layout.groups.map((g) => (
                    <div
                      key={g.key}
                      style={{ position: "absolute", transform: `translate(${g.x}px, ${g.y}px)`, width: g.w, height: g.h }}
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
                      style={{ position: "absolute", transform: `translate(${c.x}px, ${layout.top - 36}px)`, width: c.w }}
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
            aria-label={panel === "edit" ? "Flow editor" : "Details"}
            className="z-10 flex flex-col overflow-hidden bg-surface max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[72%] max-md:rounded-t-lg max-md:border-t max-md:border-line max-md:shadow-overlay md:w-[22rem] md:shrink-0 md:border-l md:border-line"
          >
            {panel === "edit" && workspace ? (
              <>
                <PanelHead icon={<Workflow />} title="Edit flow" sub="Reorder, join or drop steps, then save." onClose={() => setPanel(selected ? "details" : null)} />
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
        Click a card for its details, double-click to open it. Hover to light what it connects to. The dot is how its last run ended; counts are the last 7 days.
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
      <span className="inline-flex items-center gap-1.5">{line()}contains</span>
      <span className="inline-flex items-center gap-1.5">{line("5 4")}uses</span>
      <span className="inline-flex items-center gap-1.5">{line("1.5 4")}hands off</span>
    </div>
  );
}

function ZoomBar({ onFit, onReset, minimap, onMinimap }: { onFit: () => void; onReset: () => void; minimap: boolean; onMinimap: () => void }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 text-fg-secondary shadow-xs">
      <Tooltip label="Zoom out (−)">
        <Button size="icon-sm" variant="ghost" onClick={() => void rf.zoomOut({ duration: 200 })} aria-label="Zoom out">
          <Minus />
        </Button>
      </Tooltip>
      <Tooltip label="Fit everything in view (0)">
        <button type="button" onClick={onFit} className="h-8 min-w-[3.25rem] rounded-sm px-1 text-[13px] tabular-nums hover:bg-muted">
          {Math.round(zoom * 100)}%
        </button>
      </Tooltip>
      <Tooltip label="Zoom in (+)">
        <Button size="icon-sm" variant="ghost" onClick={() => void rf.zoomIn({ duration: 200 })} aria-label="Zoom in">
          <Plus />
        </Button>
      </Tooltip>
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <Tooltip label="Fit everything in view (0)">
        <Button size="icon-sm" variant="ghost" onClick={onFit} aria-label="Fit">
          <Maximize />
        </Button>
      </Tooltip>
      <Tooltip label="Put dragged cards back">
        <Button size="icon-sm" variant="ghost" onClick={onReset} aria-label="Reset layout">
          <RotateCcw />
        </Button>
      </Tooltip>
      <Tooltip label={minimap ? "Hide the minimap" : "Show the minimap"}>
        <Button size="icon-sm" variant="ghost" onClick={onMinimap} aria-pressed={minimap} aria-label="Minimap" className="max-md:hidden aria-pressed:bg-muted aria-pressed:text-fg">
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
      <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close panel" className="-mr-1.5">
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
      if (n.scope === "account") out.push({ label: "Open library", href: `/dashboard/library${q}` });
      else if (n.href) out.push({ label: "Open workspace", href: n.href });
      break;
    case "agent":
      if (ws) out.push({ label: "Open agent", href: `/dashboard/${ws}/agents/${encodeURIComponent(n.label)}${q}` });
      if (n.href) out.push({ label: "Open file", href: n.href });
      break;
    case "flow":
      if (ws) out.push({ label: "Open flow", href: `/dashboard/${ws}/flows?flow=${encodeURIComponent(n.label)}${qa}` });
      if (n.href) out.push({ label: "Open file", href: n.href });
      break;
    case "tool":
      if (n.scope === "account") out.push({ label: "Open in library", href: `/dashboard/library?kind=tools${qa}` });
      else if (n.scope === "workspace" && ws) out.push({ label: "Open in Tools", href: `/dashboard/${ws}/assets?kind=tools${qa}` });
      break;
    default:
      if (n.scope === "account") out.push({ label: "Open in library", href: `/dashboard/library?kind=${plural}${qa}` });
      else if (ws) out.push({ label: "Open in Files", href: `/dashboard/${ws}/edit?scope=${plural}${qa}` });
  }
  return out;
}

const SCOPE_WORD: Record<Scope, string> = { account: "Account library", workspace: "Workspace", agent: "Agent's own" };

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
  const kindWord = node.kind === "scope" ? (node.scope === "account" ? "Account" : "Workspace") : KIND_WORD[node.kind];
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
              <dt className="text-fg-muted">Last run</dt>
              <dd className="mt-0.5">{outcome ? <Status outcome={outcome} /> : <span className="text-fg-secondary">{stats.last}</span>}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Started</dt>
              <dd className="mt-0.5 text-fg-secondary">{fmtAgo(openedAt - Date.parse(stats.lastAt))}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Runs, 7 days</dt>
              <dd className="mt-0.5 tabular-nums text-fg">{stats.runs}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Spend, 7 days</dt>
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
                Edit steps
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
                        <span className="shrink-0 text-xs text-fg-subtle">{n.kind === "scope" ? (n.scope === "account" ? "account" : "workspace") : n.kind}</span>
                        {o && <StatusDot outcome={o} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        ) : (
          <p className="text-[13px] text-fg-muted">Nothing connects to this yet.</p>
        )}
      </div>
    </>
  );
}
