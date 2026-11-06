// Where the graph's cards go: the same graph always draws the same picture,
// no two cards ever overlap, and the map reads left to right — workspace,
// flows, agents, tools, then skills and files.

import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, mapLayout, treeLayout, packedMapLayout, overlaps, settle, layerOf } from "../components/graph-layout-model.ts";
import type { GLink, GNode, Kind, Scope } from "../server/graph.ts";

const node = (id: string, kind: Kind, scope?: Scope): GNode => ({ id, kind, scope, label: id.split(":").pop()!, degree: 0 });

function workspace(ws: string, agents = 4, files = 6): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [node(`scope:${ws}`, "scope", "workspace")];
  const links: GLink[] = [{ source: "scope:account", target: `scope:${ws}`, kind: "owns" }];
  for (let a = 0; a < agents; a++) {
    const id = `agent:${ws}:a${a}`;
    nodes.push(node(id, "agent", "agent"));
    links.push({ source: `scope:${ws}`, target: id, kind: "owns" });
    nodes.push(node(`skill:${ws}:a${a}:s`, "skill", "agent"), node(`tool:${ws}:a${a}:read`, "tool", "agent"));
    links.push({ source: id, target: `skill:${ws}:a${a}:s`, kind: "owns" }, { source: id, target: `tool:${ws}:a${a}:read`, kind: "use" });
    if (a > 0) links.push({ source: `agent:${ws}:a${a - 1}`, target: id, kind: "step" });
  }
  for (let f = 0; f < 3; f++) {
    const id = `flow:${ws}:f${f}`;
    nodes.push(node(id, "flow", "workspace"));
    links.push({ source: `scope:${ws}`, target: id, kind: "owns" }, { source: id, target: `agent:${ws}:a${f % agents}`, kind: "owns" });
  }
  for (let k = 0; k < files; k++) {
    nodes.push(node(`knowledge:${ws}:doc ${k}: with colons`, "knowledge", "workspace"));
    links.push({ source: `scope:${ws}`, target: `knowledge:${ws}:doc ${k}: with colons`, kind: "owns" });
  }
  return { nodes, links };
}

function account(n: number) {
  const nodes: GNode[] = [node("scope:account", "scope", "account"), node("tool:account:web", "tool", "account")];
  const links: GLink[] = [{ source: "scope:account", target: "tool:account:web", kind: "owns" }];
  for (let i = 0; i < n; i++) {
    const w = workspace(`ws${i}`, 2 + (i % 4), i % 5);
    nodes.push(...w.nodes);
    links.push(...w.links, { source: "tool:account:web", target: `agent:ws${i}:a0`, kind: "use" });
  }
  return { nodes, links };
}

test("settle keeps order and spacing and moves as little as it can", () => {
  assert.deepEqual(settle([0, 100, 200], 50), [0, 100, 200]);
  assert.deepEqual(settle([10, 10, 10], 20), [-10, 10, 30]);
  const ys = settle([5, 3, 90, 91, 400], 30);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 30 - 1e-9);
});

test("the map: columns left to right by kind, nothing overlaps, every node placed", () => {
  const { nodes, links } = account(0);
  const w = workspace("demo");
  const all = [...nodes, ...w.nodes];
  const l = mapLayout(all, [...links, ...w.links]);
  assert.equal(l.pos.size, all.length);
  assert.deepEqual(overlaps(l.pos), []);
  const x = (id: string) => l.pos.get(id)!.x;
  assert.ok(x("scope:demo") < x("flow:demo:f0"));
  assert.ok(x("flow:demo:f0") < x("agent:demo:a0"));
  assert.ok(x("agent:demo:a0") < x("tool:demo:a0:read"));
  assert.ok(x("tool:demo:a0:read") < x("skill:demo:a0:s"));
  assert.equal(x("skill:demo:a0:s"), x("knowledge:demo:doc 0: with colons"), "skills and files share a column");
  // The account heads its column.
  assert.ok(l.pos.get("scope:account")!.y < l.pos.get("scope:demo")!.y);
  assert.deepEqual(l.columns.map((c) => c.label), ["Workspace", "Flows", "Agents", "Tools", "Skills and files"]);
});

test("the same graph draws the same picture, whatever order it arrives in", () => {
  const { nodes, links } = account(3);
  const a = layoutGraph("map", nodes, links);
  const b = layoutGraph("map", [...nodes].reverse(), [...links].reverse());
  assert.deepEqual([...a.pos].sort(), [...b.pos].sort());
});

test("many workspaces pack into framed tiles, none overlapping, account first", () => {
  const { nodes, links } = account(40);
  const l = layoutGraph("map", nodes, links);
  assert.equal(l.pos.size, nodes.length);
  assert.deepEqual(overlaps(l.pos), []);
  assert.equal(l.groups.length, 41);
  assert.equal(l.groups[0].label, "Account");
  const frames = new Map(l.groups.map((g) => [g.key, { x: g.x, y: g.y, w: g.w, h: g.h }]));
  assert.deepEqual(overlaps(frames), []);
  // Every card sits inside its workspace's frame.
  for (const n of nodes) {
    const key = n.scope === "account" ? "account" : n.id.split(":")[1];
    const f = frames.get(key)!;
    const b = l.pos.get(n.id)!;
    assert.ok(b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h, `${n.id} outside ${key}`);
  }
  // Roughly screen-shaped, not one long strip.
  const boxes = [...l.pos.values()];
  const w = Math.max(...boxes.map((b) => b.x + b.w));
  const h = Math.max(...boxes.map((b) => b.y + b.h));
  assert.ok(w / h > 0.6 && w / h < 4, `aspect ${w / h}`);
  assert.equal(packedMapLayout(nodes, links).groups.length, 41);
});

test("the tree: containment as a tidy tree, built-in tools under their agent, no overlaps", () => {
  const { nodes, links } = account(2);
  const l = treeLayout(nodes, links);
  assert.equal(l.pos.size, nodes.length);
  assert.deepEqual(overlaps(l.pos), []);
  const x = (id: string) => l.pos.get(id)!.x;
  assert.ok(x("scope:account") < x("scope:ws0"));
  assert.ok(x("scope:ws0") < x("agent:ws0:a0"));
  assert.ok(x("agent:ws0:a0") < x("tool:ws0:a0:read"), "a built-in tool hangs off the agent that uses it");
});

test("a flow of flows that loops still places every node once", () => {
  const nodes = [node("scope:w", "scope", "workspace"), node("flow:w:a", "flow", "workspace"), node("flow:w:b", "flow", "workspace")];
  const links: GLink[] = [
    { source: "scope:w", target: "flow:w:a", kind: "owns" },
    { source: "flow:w:a", target: "flow:w:b", kind: "owns" },
    { source: "flow:w:b", target: "flow:w:a", kind: "owns" },
  ];
  for (const name of ["map", "tree"] as const) {
    const l = layoutGraph(name, nodes, links);
    assert.equal(l.pos.size, 3);
    assert.deepEqual(overlaps(l.pos), []);
  }
  assert.equal(layerOf({ kind: "memory", scope: "agent" }), layerOf({ kind: "knowledge", scope: "account" }));
});
