// Where every card on the graph goes. Pure and deterministic — the same
// graph always draws the same picture — so tests/graph-layout.test.ts can
// pin it, and a reload never shuffles the map under the reader's eye.
//
// Two layouts:
//
//   map    columns by what a thing is, left to right: account → workspaces →
//          flows → agents → tools → skills → memory → knowledge. Order inside
//          a column is chosen to keep lines short (barycentre sweeps), and
//          heights are then settled so each card sits level with what it
//          connects to without ever overlapping (isotonic regression — the
//          least movement that keeps order and spacing).
//
//   tree   containment, read as a tidy tree: account → workspace → what it
//          holds. A node's first `owns` edge is its parent; a built-in tool,
//          owned by nothing, hangs off the agent that uses it.

import type { GLink, GNode, Kind } from "@/server/graph";

export type LayoutName = "map" | "tree";
export const LAYOUTS: LayoutName[] = ["map", "tree"];
export const isLayout = (v: unknown): v is LayoutName => v === "map" || v === "tree";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Column {
  key: string;
  label: string;
  x: number;
  w: number;
  count: number;
}

export interface Layout {
  pos: Map<string, Box>;
  /** Column headings, for the map only. */
  columns: Column[];
  /** The top of the drawing, where headings sit above. */
  top: number;
  /** Frames around each workspace, when the map packs many of them. */
  groups: Group[];
}

export interface Group {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The big cards (what runs, and where it lives) and the small ones (what they use). */
export const isMajor = (k: Kind) => k === "scope" || k === "flow" || k === "agent";
export function sizeOf(k: Kind): { w: number; h: number } {
  return isMajor(k) ? { w: 240, h: 56 } : { w: 216, h: 48 };
}
const GAP_Y_MAJOR = 14;
const GAP_Y_MINOR = 8;
const GAP_X = 96;
const gapY = (k: Kind) => (isMajor(k) ? GAP_Y_MAJOR : GAP_Y_MINOR);

export const idOf = (v: string | GNode) => (typeof v === "string" ? v : v.id);

// Five columns, not one per kind: a column per kind made a workspace eight
// columns wide and too small to read. Skills, memory and knowledge share the
// last column, where an agent's own files sit level with that agent.
const LAYER_KEYS = ["scopes", "flows", "agents", "tools", "files"] as const;

export function layerOf(n: Pick<GNode, "kind" | "scope">): number {
  switch (n.kind) {
    case "scope":
      return 0;
    case "flow":
      return 1;
    case "agent":
      return 2;
    case "tool":
      return 3;
    case "skill":
    case "memory":
    case "knowledge":
      return 4;
  }
}

function columnLabel(key: (typeof LAYER_KEYS)[number], nodes: GNode[]): string {
  const n = nodes.length;
  switch (key) {
    case "scopes": {
      const ws = nodes.filter((x) => x.scope !== "account").length;
      return ws === 0 ? "Account" : ws === 1 ? "Workspace" : "Workspaces";
    }
    case "flows":
      return n === 1 ? "Flow" : "Flows";
    case "agents":
      return n === 1 ? "Agent" : "Agents";
    case "tools":
      return n === 1 ? "Tool" : "Tools";
    case "files":
      return "Skills and files";
  }
}

/** The workspace a node belongs to, read from its id (`agent:<ws>:<name>`). */
export function workspaceOf(n: Pick<GNode, "id" | "kind" | "scope">): string | null {
  if (n.scope === "account") return null;
  const [, ws] = n.id.split(":");
  return ws ?? null;
}

/**
 * Least-squares placement that keeps order and spacing: given where each item
 * would like to be, return positions with y[i+1] >= y[i] + pitch that move
 * them as little as possible. Substituting z = y - i·pitch turns it into
 * isotonic regression, solved by pooling adjacent violators.
 */
export function settle(desired: number[], pitch: number): number[] {
  const blocks: { sum: number; n: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ sum: d - i * pitch, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + out.length * pitch);
  return out;
}

function neighbours(nodes: GNode[], links: GLink[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const l of links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (s === t || !ids.has(s) || !ids.has(t)) continue;
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  return new Map([...adj].map(([k, v]) => [k, [...v].sort()]));
}

const byName = (a: GNode, b: GNode) =>
  (workspaceOf(a) ?? "").localeCompare(workspaceOf(b) ?? "") || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

export function mapLayout(nodes: GNode[], links: GLink[]): Layout {
  const adj = neighbours(nodes, links);
  const layer = new Map(nodes.map((n) => [n.id, layerOf(n)]));
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layers: string[][] = LAYER_KEYS.map(() => []);
  // The account heads the first column, above its workspaces, always.
  const accountFirst = (a: GNode, b: GNode) => Number(b.scope === "account") - Number(a.scope === "account") || byName(a, b);
  for (const n of [...nodes].sort(accountFirst)) layers[layerOf(n)].push(n.id);

  // Order: alternate sweeps, each column sorted by the mean place of its
  // neighbours on the side the sweep comes from. A node with no neighbour
  // there keeps its place, so a sweep never scatters what it cannot see.
  const rank = new Map<string, number>();
  const rerank = (L: number) => layers[L].forEach((id, i) => rank.set(id, (i + 0.5) / layers[L].length));
  layers.forEach((_, L) => rerank(L));
  for (let iter = 0; iter < 6; iter++) {
    const down = iter % 2 === 0;
    const order = down ? [1, 2, 3, 4] : [3, 2, 1, 0];
    for (const L of order) {
      if (layers[L].length < 2) continue;
      const pinned = L === 0 && byId.get(layers[0][0])?.scope === "account";
      const key = new Map<string, number>();
      for (const id of layers[L]) {
        const ns = adj.get(id)!.filter((m) => (down ? layer.get(m)! < L : layer.get(m)! > L));
        key.set(id, ns.length ? ns.reduce((s, m) => s + rank.get(m)!, 0) / ns.length : rank.get(id)!);
      }
      layers[L] = layers[L]
        .map((id, i) => ({ id, i }))
        .sort((a, b) => (pinned ? Number(b.i === 0) - Number(a.i === 0) : 0) || key.get(a.id)! - key.get(b.id)! || a.i - b.i)
        .map((e) => e.id);
      rerank(L);
    }
  }

  // Columns: only the ones with something in them, side by side.
  const columns: Column[] = [];
  const colX = new Map<number, number>();
  let x = 0;
  layers.forEach((ids, L) => {
    if (!ids.length) return;
    const w = sizeOf(kind.get(ids[0])!).w;
    const label = columnLabel(LAYER_KEYS[L], ids.map((id) => byId.get(id)!));
    const count = L === 0 ? ids.filter((id) => byId.get(id)!.scope !== "account").length || ids.length : ids.length;
    columns.push({ key: LAYER_KEYS[L], label, x, w, count });
    colX.set(L, x);
    x += w + GAP_X;
  });

  // Heights: every column starts stacked and centred, then each card is
  // pulled level with the centre of what it connects to, columns taking
  // turns, settled so nothing overlaps.
  const centre = new Map<string, number>();
  const sz = (id: string) => sizeOf(kind.get(id)!);
  layers.forEach((ids) => {
    if (!ids.length) return;
    const h = sz(ids[0]).h;
    const pitch = h + gapY(kind.get(ids[0])!);
    const total = ids.length * pitch - gapY(kind.get(ids[0])!);
    ids.forEach((id, i) => centre.set(id, i * pitch + h / 2 - total / 2));
  });
  // The tallest column anchors; the rest come to it.
  const anchor = layers.reduce((best, ids, L) => (ids.length > layers[best].length ? L : best), 0);
  const pass = (L: number) => {
    const ids = layers[L];
    if (!ids.length) return;
    const h = sz(ids[0]).h;
    const pitch = h + gapY(kind.get(ids[0])!);
    const desired = ids.map((id) => {
      const ns = adj.get(id)!.filter((m) => layer.get(m) !== L);
      return (ns.length ? ns.reduce((s, m) => s + centre.get(m)!, 0) / ns.length : centre.get(id)!) - h / 2;
    });
    settle(desired, pitch).forEach((y, i) => centre.set(ids[i], y + h / 2));
  };
  for (let iter = 0; iter < 4; iter++) {
    for (let L = anchor - 1; L >= 0; L--) pass(L);
    for (let L = anchor + 1; L < layers.length; L++) pass(L);
    if (iter < 3) for (let L = 0; L < layers.length; L++) if (L !== anchor) pass(L);
  }

  const pos = new Map<string, Box>();
  let top = Infinity;
  layers.forEach((ids, L) => {
    for (const id of ids) {
      const { w, h } = sz(id);
      const y = Math.round(centre.get(id)! - h / 2);
      top = Math.min(top, y);
      pos.set(id, { x: colX.get(L)!, y, w, h });
    }
  });
  return { pos, columns, top: Number.isFinite(top) ? top : 0, groups: [] };
}

export function treeLayout(nodes: GNode[], links: GLink[]): Layout {
  const ids = new Set(nodes.map((n) => n.id));
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  const adopt = (p: string, c: string) => {
    if (parent.has(c) || p === c || !ids.has(p) || !ids.has(c)) return;
    parent.set(c, p);
    children.set(p, [...(children.get(p) ?? []), c]);
  };
  // First `owns` wins — the builder pushes the workspace's claim first, so an
  // agent hangs under its workspace and a flow's claim stays a drawn edge.
  for (const l of links) if (l.kind === "owns") adopt(idOf(l.source), idOf(l.target));
  // Then a thing nothing owns hangs off whoever uses it (an agent's built-in tool).
  for (const l of links) {
    if (l.kind !== "use") continue;
    const s = idOf(l.source);
    const t = idOf(l.target);
    if (kind.get(s) === "agent") adopt(s, t);
    else if (kind.get(t) === "agent") adopt(t, s);
  }

  const COL = 240 + GAP_X;
  const pos = new Map<string, Box>();
  const placed = new Set<string>(); // a flow of flows can loop
  let cursor = 0;
  const place = (id: string, depth: number): number => {
    if (placed.has(id)) return (pos.get(id)?.y ?? 0) + (pos.get(id)?.h ?? 0) / 2;
    placed.add(id);
    const { w, h } = sizeOf(kind.get(id)!);
    const kids = [...(children.get(id) ?? [])].sort((a, b) => {
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      return layerOf(na) - layerOf(nb) || na.label.localeCompare(nb.label);
    });
    let c: number;
    if (!kids.length) {
      c = cursor + h / 2;
      cursor += h + gapY(kind.get(id)!);
    } else {
      const cs = kids.map((k) => place(k, depth + 1));
      c = (Math.min(...cs) + Math.max(...cs)) / 2;
    }
    pos.set(id, { x: depth * COL, y: Math.round(c - h / 2), w, h });
    return c;
  };
  const roots = nodes.filter((n) => !parent.has(n.id)).sort((a, b) => layerOf(a) - layerOf(b) || byName(a, b));
  for (const r of roots) {
    place(r.id, 0);
    cursor += 24; // a gap between trees of the forest
  }
  // Any node a cycle hid from every root still gets a place.
  for (const n of nodes) if (!placed.has(n.id)) place(n.id, 0);
  const top = Math.min(0, ...[...pos.values()].map((b) => b.y));
  return { pos, columns: [], top, groups: [] };
}

/**
 * The map of many workspaces: one small map per workspace, each in its own
 * frame, packed into rows like tiles — the account and its library first.
 * One long map of every workspace stacked made five columns hundreds of cards
 * tall, a strip too thin to read at any zoom that showed all of it.
 */
export function packedMapLayout(nodes: GNode[], links: GLink[]): Layout {
  const PAD = 20;
  const HEAD = 36;
  const GAP = 72;
  const groupOf = (n: GNode) => (n.scope === "account" ? "" : (workspaceOf(n) ?? ""));
  const members = new Map<string, GNode[]>();
  for (const n of nodes) {
    const g = groupOf(n);
    members.set(g, [...(members.get(g) ?? []), n]);
  }
  const keys = [...members.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  const tiles = keys.map((key) => {
    const ns = members.get(key)!;
    const ids = new Set(ns.map((n) => n.id));
    const inner = mapLayout(ns, links.filter((l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target))));
    const boxes = [...inner.pos.values()];
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - minX + PAD * 2;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - minY + PAD * 2 + HEAD;
    return { key, label: key === "" ? "Account" : key, inner, minX, minY, w, h };
  });
  // Rows about as wide as the whole is tall, for a screen-shaped picture.
  const area = tiles.reduce((s, t) => s + (t.w + GAP) * (t.h + GAP), 0);
  const rowW = Math.max(Math.max(...tiles.map((t) => t.w)), Math.sqrt(area * 1.6));
  const pos = new Map<string, Box>();
  const groups: Group[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const t of tiles) {
    if (x > 0 && x + t.w > rowW) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    groups.push({ key: t.key || "account", label: t.label, x, y, w: t.w, h: t.h });
    for (const [id, b] of t.inner.pos) pos.set(id, { ...b, x: b.x - t.minX + x + PAD, y: b.y - t.minY + y + PAD + HEAD });
    x += t.w + GAP;
    rowH = Math.max(rowH, t.h);
  }
  return { pos, columns: [], top: 0, groups };
}

export function layoutGraph(name: LayoutName, nodes: GNode[], links: GLink[]): Layout {
  if (name === "tree") return treeLayout(nodes, links);
  const workspaces = nodes.filter((n) => n.kind === "scope" && n.scope !== "account").length;
  return workspaces > 1 ? packedMapLayout(nodes, links) : mapLayout(nodes, links);
}

/** Two boxes in the same picture that overlap — the thing a layout must never do. */
export function overlaps(pos: Map<string, Box>): [string, string][] {
  const out: [string, string][] = [];
  const all = [...pos];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [a, A] = all[i];
      const [b, B] = all[j];
      if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) out.push([a, b]);
    }
  return out;
}
