"use client";

// Obsidian-style force graph of a workspace: every agent, flow, skill and
// memory file is a dot, and edges are the real relations between them —
// a flow's steps, an agent's skills, an agent's memory. Layout is a d3
// force simulation, so structure emerges rather than being drawn: agents
// that share flows drift together, isolated agents sit at the edge.
//
// Rendering is plain SVG (no node-graph library) to keep it minimal:
// thin links, dots sized by connectedness, labels that fade in as you
// zoom. Hovering isolates a node's neighbourhood; clicking opens its file.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import type { AgentInfo, AgentAssets, FlowInfo } from "@/lib/store";
import { FlowPanel } from "./flow-panel";
import { buttonClass } from "@/components/ui";
import { statsLine, fmtAgo } from "@/components/graph-stats-model";

type AgentWithAssets = AgentInfo & { assets: AgentAssets };

// The model lives in lib/graph.ts so the account view draws with the same
// shapes rather than its own copy of them.
import type { Kind, Scope, GNode, GLink, Graph, SharedAssets } from "@/server/graph";
export type { SharedAssets };


const SCOPE_COLOR: Record<Scope, string> = {
  account: "var(--color-violet-600)",
  workspace: "var(--color-blue-600)",
  agent: "var(--color-emerald-600)",
};

// Assets are coloured by the SCOPE they live in, not by what they are — that
// is the thing you cannot see from a file listing.
const COLOR: Record<Kind, string> = {
  agent: "var(--color-gray-900)",
  flow: "var(--color-emerald-600)",
  scope: "var(--color-gray-500)",
  skill: "var(--color-gray-400)",
  memory: "var(--color-violet-300)",
  knowledge: "var(--color-blue-300)",
  tool: "var(--color-amber-400)",
};

const RADIUS: Record<Kind, number> = {
  agent: 7, flow: 6, scope: 10, skill: 3.5, memory: 3.5, knowledge: 3.5, tool: 3.5,
};

// The small dot on an agent or flow: how its last run ended, in the runs
// page's own colours — green done, red failed, amber still going or waiting
// on a person, grey stopped or never finished.
const STATUS_DOT: Record<string, string> = {
  completed: "var(--color-emerald-500)",
  failed: "var(--color-red-500)",
  running: "var(--color-amber-500)",
  "awaiting-approval": "var(--color-amber-500)",
  stopped: "var(--color-gray-400)",
  queued: "var(--color-gray-400)",
  pending: "var(--color-gray-400)",
  skipped: "var(--color-gray-400)",
};

// The camera: the graph's origin sits at the viewport centre, then the whole
// picture is scaled by k and offset by (x, y) in graph units. Zoom is a wide
// range in log space — 0.1 lets a large account read as a shape, 8 lets a
// label be read at arm's length.
type View = { x: number; y: number; k: number };
const MIN_K = 0.1;
const MAX_K = 8;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** The camera that shows every node, with a margin for labels and the header. */
function fitView(nodes: { x?: number; y?: number }[], w: number, h: number, maxK = 1): View {
  const pts = nodes.filter((n) => n.x !== undefined && n.y !== undefined) as { x: number; y: number }[];
  if (!pts.length) return { x: 0, y: 0, k: 1 };
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const bw = maxX - minX + 340; // room for labels
  const bh = maxY - minY + 200; // room for the header and the hint line
  const k = clampK(Math.min(maxK, w / bw, h / bh));
  return { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, k };
}

/**
 * The hierarchy layout: the same `owns` edges the force view treats as mere
 * springs, read as what they are — containment. Workspace → agents, flows
 * and shared assets; agent → its skills and memory; flow → its steps. An
 * agent can have two owners (its workspace, and every flow that steps it);
 * the first `owns` edge wins as the tree parent — the builder pushes
 * workspace-ownership first, so agents sit under the workspace and a flow's
 * claim on them stays visible as a drawn edge rather than a tree position.
 *
 * Left-to-right tidy tree: depth is the x column, leaves stack downward,
 * parents centre on their children. Pure function of the graph, so Reset can
 * reapply it and toggling layouts is idempotent.
 */
function treePositions(graph: Graph): Map<string, { x: number; y: number }> {
  const DX = 190;
  const DY = 34;
  const idOf = (v: string | GNode) => (typeof v === "string" ? v : v.id);
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const l of graph.links) {
    if (l.kind !== "owns") continue;
    const source = idOf(l.source);
    const target = idOf(l.target);
    if (hasParent.has(target)) continue; // first parent wins
    hasParent.add(target);
    children.set(source, [...(children.get(source) ?? []), target]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>(); // cycle guard — a flow of flows can loop
  let leaf = 0;
  const place = (id: string, depth: number): number => {
    if (placed.has(id)) return pos.get(id)?.y ?? 0;
    placed.add(id);
    const kids = children.get(id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = leaf * DY;
      leaf += 1;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    pos.set(id, { x: depth * DX, y });
    return y;
  };
  const roots = graph.nodes.filter((n) => !hasParent.has(n.id));
  for (const r of roots) {
    place(r.id, 0);
    leaf += 1; // a gap between trees of the forest
  }
  // Centre the whole forest on the origin, where the viewport starts.
  const xs = [...pos.values()];
  if (xs.length) {
    const cx = (Math.min(...xs.map((p) => p.x)) + Math.max(...xs.map((p) => p.x))) / 2;
    const cy = (Math.min(...xs.map((p) => p.y)) + Math.max(...xs.map((p) => p.y))) / 2;
    for (const p of xs) {
      p.x -= cx;
      p.y -= cy;
    }
  }
  return pos;
}

export function GraphClient({
  workspace,
  tenant,
  agents = [],
  flows = [],
  graph,
  title,
  emptyMessage,
}: {
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
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);



  const [, setFrame] = useState(0); // repaint on each simulation tick
  const [hover, setHover] = useState<string | null>(null);
  // The clock the hover text reads "3h ago" against: fixed when the page
  // opened, because a render must not consult the wall clock, and a graph
  // is not open long enough for the difference to show.
  const [openedAt] = useState(() => Date.now());
  const [layout, setLayout] = useState<"force" | "tree">("force");
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [showPanel, setShowPanel] = useState(false);
  const dragRef = useRef<{ id: string | null; panFrom: { x: number; y: number } | null }>({
    id: null,
    panFrom: null,
  });
  // Every pointer that is currently down, for two-finger pinch on a touch
  // screen. A mouse never puts more than one entry here.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const animRef = useRef<number | null>(null);
  // The current camera, readable from callbacks that outlive a render.
  const viewRef = useRef<View>(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const viewport = () => {
    const el = svgRef.current;
    return { w: el?.clientWidth ?? 1200, h: el?.clientHeight ?? 800 };
  };

  // Zoom by a factor about a screen point (measured from the viewport
  // centre), keeping whatever is under that point exactly where it is. The
  // point under the cursor is p/k - v in graph units; solving for the offset
  // that leaves it fixed at the new scale gives the two correction terms.
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      if (k === v.k) return v;
      return { k, x: v.x + px / k - px / v.k, y: v.y + py / k - py / v.k };
    });
  }, []);

  // A programmatic move (fit, reset, keyboard, double-click) glides rather
  // than cuts, so the eye can keep track of what it was looking at. Scale
  // interpolates in log space — that is what reads as constant-speed zoom.
  const animateTo = useCallback((target: View, ms = 260) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = performance.now();
    const from = viewRef.current;
    const step = (t: number) => {
      const u = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - u, 3); // ease-out cubic
      const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      setView({ k, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      animRef.current = u < 1 ? requestAnimationFrame(step) : null;
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  const fit = useCallback(() => {
    const { w, h } = viewport();
    animateTo(fitView(graph.nodes, w, h, layout === "tree" ? 1 : 1.5));
  }, [graph, layout, animateTo]);

  // Wheel is attached by hand: React registers it passive, so preventDefault
  // cannot stop the page scrolling under the graph. Zoom is proportional to
  // the delta — a trackpad's stream of tiny deltas becomes a glide, one mouse
  // notch a firm step — and a pinch arrives as a ctrl-wheel, scaled up so a
  // finger's travel matches what it does in a map.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      const rect = svg.getBoundingClientRect();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; // lines
      else if (e.deltaMode === 2) dy *= rect.height; // pages
      const sensitivity = e.ctrlKey ? 0.01 : 0.0025;
      const factor = Math.exp(-Math.max(-120, Math.min(120, dy)) * sensitivity);
      zoomAt(factor, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Keyboard: + and − zoom about the centre, 0 fits, when nothing else has
  // the keys — the flow editor's inputs must keep their own minus signs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") zoomAt(1.25, 0, 0);
      else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.25, 0, 0);
      else if (e.key === "0") fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, fit]);

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);

  // Run the force simulation — or, in hierarchy mode, don't: positions are
  // computed once from the containment tree and pinned. One effect owns both
  // so a toggle is a clean teardown, never two layouts fighting over x/y.
  useEffect(() => {
    if (layout === "tree") {
      const pos = treePositions(graph);
      for (const n of graph.nodes) {
        const p = pos.get(n.id);
        if (p) {
          n.x = p.x;
          n.y = p.y;
          n.fx = p.x;
          n.fy = p.y;
        }
      }
      // Fit the whole tree in the viewport: a deep workspace is taller than
      // the screen at zoom 1, and a layout you have to hunt for defeats the
      // point of switching to it. Never zoom past 1 — a tiny tree stays
      // life-size rather than ballooning.
      const { w, h } = viewport();
      if (pos.size) animateTo(fitView(graph.nodes, w, h, 1));
      setFrame((f) => f + 1);
      return;
    }
    for (const n of graph.nodes) {
      n.fx = null;
      n.fy = null;
    }
    const sim = forceSimulation<GNode, GLink>(graph.nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(graph.links)
          .id((d) => d.id)
          .distance((l) => ((l as GLink).kind === "owns" ? 46 : 120))
          .strength((l) => ((l as GLink).kind === "owns" ? 0.9 : 0.35)),
      )
      .force("charge", forceManyBody<GNode>().strength((d) => (d.kind === "skill" || d.kind === "memory" ? -90 : -420)))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GNode>((d) => RADIUS[d.kind] + 12))
      .alphaDecay(0.045);

    sim.on("tick", () => setFrame((f) => f + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [graph, layout, animateTo]);

  // Pointer handling: drag a node to pin it, drag the background to pan,
  // wheel to zoom around the cursor.
  const toGraphCoords = (e: React.PointerEvent | React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - rect.width / 2) / view.k - view.x,
      y: (e.clientY - rect.top - rect.height / 2) / view.k - view.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pointers = pointersRef.current;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers down: the gap between them is the zoom, their midpoint the
    // anchor and the pan. A pinch overrides whatever a single finger began.
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const prev = pinchRef.current;
      if (prev && prev.dist > 0) {
        const rect = svgRef.current!.getBoundingClientRect();
        zoomAt(dist / prev.dist, mid.x - rect.left - rect.width / 2, mid.y - rect.top - rect.height / 2);
        setView((v) => ({ ...v, x: v.x + (mid.x - prev.mid.x) / v.k, y: v.y + (mid.y - prev.mid.y) / v.k }));
      }
      pinchRef.current = { dist, mid };
      return;
    }
    const { id, panFrom } = dragRef.current;
    if (id) {
      const p = toGraphCoords(e);
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        node.fx = p.x;
        node.fy = p.y;
        if (layout === "tree") {
          // No simulation to carry the pin into x/y — do it directly.
          node.x = p.x;
          node.y = p.y;
          setFrame((f) => f + 1);
        } else {
          simRef.current?.alpha(0.3).restart();
        }
      }
    } else if (panFrom) {
      setView((v) => ({
        ...v,
        x: v.x + (e.clientX - panFrom.x) / v.k,
        y: v.y + (e.clientY - panFrom.y) / v.k,
      }));
      dragRef.current.panFrom = { x: e.clientX, y: e.clientY };
    }
  };

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const l of graph.links) {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      if (s === hover) set.add(t);
      if (t === hover) set.add(s);
    }
    return set;
  }, [hover, graph.links]);

  const dim = (id: string) => (neighbours ? (neighbours.has(id) ? 1 : 0.12) : 1);

  return (
    <main className="relative h-screen overflow-hidden bg-surface">
      {/* header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-5">
        <div className="pointer-events-auto">
          <Link
            href={
              workspace
                ? `/dashboard/${workspace}${tenant !== "default" ? `?tenant=${tenant}` : ""}`
                : `/dashboard${tenant !== "default" ? `?tenant=${tenant}` : ""}`
            }
            className="text-sm font-medium text-fg-subtle transition-colors hover:text-fg-secondary"
          >
            ← {title ?? workspace}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
            {(["agent", "flow", "skill", "knowledge", "memory", "tool"] as Kind[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 7, height: 7, background: COLOR[k] }}
                />
                {k}
              </span>
            ))}
            <span className="mx-1 h-3 w-px bg-muted-strong" />
            {(["account", "workspace", "agent"] as Scope[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 8, height: 8, border: `1.5px solid ${SCOPE_COLOR[s]}` }}
                />
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setShowPanel((s) => !s)}
            className={buttonClass("secondary")}
          >
            {showPanel ? "Hide flow editor" : "Edit flow"}
          </button>
          <button
            onClick={() => setLayout((l) => (l === "force" ? "tree" : "force"))}
            className={buttonClass("secondary")}
          >
            {layout === "force" ? "Hierarchy" : "Force"}
          </button>
          <button onClick={fit} className={buttonClass("secondary")} title="Fit everything in view (0)">
            Fit
          </button>
          <button
            onClick={() => {
              animateTo({ x: 0, y: 0, k: 1 });
              if (layout === "tree") {
                // Reapply the tree — a dragged node snaps home.
                const pos = treePositions(graph);
                graph.nodes.forEach((n) => {
                  const p = pos.get(n.id);
                  if (p) {
                    n.x = p.x;
                    n.y = p.y;
                    n.fx = p.x;
                    n.fy = p.y;
                  }
                });
                setFrame((f) => f + 1);
              } else {
                graph.nodes.forEach((n) => {
                  n.fx = null;
                  n.fy = null;
                });
                simRef.current?.alpha(0.8).restart();
              }
            }}
            className={buttonClass("secondary")}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Editing a flow needs a workspace to write into. The account view spans
          many, so it shows the picture and links out rather than editing here. */}
      {showPanel && workspace && (
        <div className="absolute right-5 top-20 z-10 w-96">
          <FlowPanel
            workspace={workspace}
            tenant={tenant}
            flows={flows}
            agents={agents.map((a) => a.name)}
            onSaved={() => router.refresh()}
          />
        </div>
      )}

      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: dragRef.current.panFrom ? "grabbing" : "default" }}
        onPointerDown={(e) => {
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          svgRef.current?.setPointerCapture(e.pointerId);
          if (pointersRef.current.size === 1) dragRef.current.panFrom = { x: e.clientX, y: e.clientY };
          else dragRef.current = { id: null, panFrom: null };
        }}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          pointersRef.current.delete(e.pointerId);
          pinchRef.current = null;
          dragRef.current = { id: null, panFrom: null };
        }}
        onPointerCancel={(e) => {
          pointersRef.current.delete(e.pointerId);
          pinchRef.current = null;
          dragRef.current = { id: null, panFrom: null };
        }}
        onDoubleClick={(e) => {
          // Double-click the background to step in around that spot; with
          // shift, step back out. The nodes stop the event so a double-click
          // on a dot stays a click that opens its file.
          const rect = svgRef.current!.getBoundingClientRect();
          const px = e.clientX - rect.left - rect.width / 2;
          const py = e.clientY - rect.top - rect.height / 2;
          const factor = e.shiftKey ? 1 / 1.8 : 1.8;
          const k = clampK(view.k * factor);
          animateTo({ k, x: view.x + px / k - px / view.k, y: view.y + py / k - py / view.k });
        }}
      >
        <g transform={`translate(${(svgRef.current?.clientWidth ?? 0) / 2}, ${(svgRef.current?.clientHeight ?? 0) / 2}) scale(${view.k}) translate(${view.x}, ${view.y})`}>
          {graph.links.map((l, i) => {
            const s = l.source as GNode;
            const t = l.target as GNode;
            if (!s?.x || !t?.x) return null;
            const opacity = neighbours
              ? neighbours.has(s.id) && neighbours.has(t.id)
                ? 0.55
                : 0.06
              : l.kind === "step"
                ? 0.32
                : l.kind === "consult" || l.kind === "delegate"
                  ? 0.4
                  : l.kind === "use"
                  ? // The capability edges are what the graph is FOR — at
                    // containment opacity they read as noise and the view
                    // degenerates into "a workspace owns things".
                    0.45
                  : 0.16;
            // A consult is agent→agent: drawn in the agent's own colour so
            // the team's shape reads apart from the toolbox and the flow.
            const stroke =
              l.kind === "step" ? COLOR.flow : l.kind === "use" ? COLOR.tool : l.kind === "consult" || l.kind === "delegate" ? COLOR.agent : "var(--color-gray-400)";
            // A delegate (subagents:) does work and a consult only answers:
            // solid and heavier for the first, dotted for the second.
            const strokeWidth = l.kind === "step" ? 1.2 : l.kind === "delegate" ? 2 : l.kind === "use" || l.kind === "consult" ? 1.4 : 0.8;
            const dash = l.kind === "use" ? "3 2" : l.kind === "consult" ? "1 3" : undefined;
            if (layout === "tree") {
              // Horizontal elbows read as a tree; straight lines read as string.
              const mx = (s.x! + t.x!) / 2;
              return (
                <path
                  key={i}
                  d={`M ${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${t.y}, ${t.x} ${t.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  strokeOpacity={opacity}
                />
              );
            }
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={dash}
                strokeOpacity={opacity}
              />
            );
          })}

          {graph.nodes.map((n) => {
            if (n.x === undefined) return null;
            const r = RADIUS[n.kind] + Math.min(4, n.degree * 0.7);
            const isMinor = n.kind === "skill" || n.kind === "memory";
            const opacity = dim(n.id);
            // The main label's fade, reused by the counter line so the two
            // arrive together.
            const labelOpacity = isMinor
              ? layout === "tree" ? 1 : Math.max(0, Math.min(1, (view.k - 0.7) / 0.3))
              : Math.max(0, Math.min(1, (view.k - 0.3) / 0.2));
            const stats = n.stats;
            const hoverText = stats
              ? `${n.label} — last run ${stats.last}, ${fmtAgo(openedAt - Date.parse(stats.lastAt))} · ${statsLine(stats)} in 7 days`
              : undefined;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                opacity={opacity}
                style={{ cursor: n.href ? "pointer" : "grab" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                  svgRef.current?.setPointerCapture(e.pointerId);
                  dragRef.current = { id: n.id, panFrom: null };
                  n.fx = n.x;
                  n.fy = n.y;
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => {
                  if (n.href && !dragRef.current.id) router.push(n.href);
                }}
              >
                {hoverText && <title>{hoverText}</title>}
                <circle r={r} fill={COLOR[n.kind]} />
                {/* The ring is the scope. An account skill and an agent's own
                    skill are the same kind of thing at different levels — that
                    difference is the whole point of the picture. */}
                {n.scope && (
                  <circle
                    r={r + 2.5}
                    fill="none"
                    stroke={SCOPE_COLOR[n.scope]}
                    strokeWidth={n.kind === "scope" ? 2 : 1.2}
                    strokeOpacity={n.kind === "scope" ? 0.9 : 0.65}
                  />
                )}
                {/* How the last run ended, pinned to the dot's shoulder so it
                    reads at any zoom; a run still going breathes. */}
                {stats && (
                  <circle
                    cx={r * 0.8}
                    cy={-r * 0.8}
                    r={3.2}
                    fill={STATUS_DOT[stats.last] ?? "var(--color-gray-400)"}
                    stroke="var(--color-white)"
                    strokeWidth={1.2}
                  >
                    {(stats.last === "running" || stats.last === "awaiting-approval") && (
                      <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
                    )}
                  </circle>
                )}
                <text
                  x={layout === "tree" ? r + 7 : 0}
                  y={layout === "tree" ? 3.5 : r + 11}
                  textAnchor={layout === "tree" ? "start" : "middle"}
                  className="pointer-events-none"
                  style={{
                    fontSize: isMinor ? 8.5 : 10.5,
                    fill: isMinor ? "var(--color-gray-400)" : "var(--color-gray-700)",
                    fontWeight: n.kind === "agent" ? 600 : 400,
                    // Labels come in as you approach: the small ones first
                    // vanish, then far out even agents go, and the picture
                    // is only its shape. A fade rather than a switch so
                    // zooming through the threshold does not flicker.
                    opacity: labelOpacity,
                    transition: "opacity 120ms",
                  }}
                >
                  {n.label}
                </text>
                {/* The counters, under the name (beside it in the tree, whose
                    rows are too close for a second line): runs and spend in
                    the window. Nothing at all where nothing ran. */}
                {stats && stats.runs > 0 && (
                  <text
                    x={layout === "tree" ? r + 7 : 0}
                    y={layout === "tree" ? 14 : r + 21}
                    textAnchor={layout === "tree" ? "start" : "middle"}
                    className="pointer-events-none"
                    style={{ fontSize: 8, fill: "var(--color-gray-400)", opacity: labelOpacity, transition: "opacity 120ms" }}
                  >
                    {statsLine(stats)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-fg-subtle">
            {emptyMessage ?? "Nothing to graph yet — add an agent to this workspace."}
          </p>
        </div>
      )}

      <p className="pointer-events-none absolute bottom-4 left-5 text-[11px] text-fg-subtle">
        drag a dot to pin it · drag the background to pan · scroll or pinch to zoom · double-click to zoom in · click to open its file · the small dot is how the last run ended · counts are the last 7 days
      </p>

      {/* Zoom cluster: the same moves as the wheel and keys, for a mouse
          without a wheel and for anyone who wants to know how far in they are. */}
      <div className="absolute bottom-4 right-5 flex items-center gap-1 rounded-lg border border-line bg-surface/90 p-1 text-xs text-fg-tertiary shadow-sm backdrop-blur">
        <button
          onClick={() => zoomAt(1 / 1.25, 0, 0)}
          className="h-6 w-6 rounded hover:bg-muted"
          title="Zoom out (−)"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={fit}
          className="min-w-[3.5rem] rounded px-1 tabular-nums hover:bg-muted"
          title="Fit everything in view (0)"
        >
          {Math.round(view.k * 100)}%
        </button>
        <button
          onClick={() => zoomAt(1.25, 0, 0)}
          className="h-6 w-6 rounded hover:bg-muted"
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
    </main>
  );
}
