// The graph draws the team's edges: `agents:` (consult) and `subagents:`
// (delegate) — a delegate does work, a consult only answers, and each is
// drawn so, never mixed up.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspaceDir } from "../../foldrun-core/src/store.ts";
import { buildWorkspaceGraph } from "../server/graph.ts";

test("subagents: draws a delegate edge; agents: a consult edge; unknown names nothing", () => {
  const ws = `graph-sub-${process.pid}`;
  const dir = workspaceDir("default", ws);
  const agent = (name: string, front: string) => {
    fs.mkdirSync(path.join(dir, "agents", name), { recursive: true });
    fs.writeFileSync(path.join(dir, "agents", name, "agent.md"), `---\nname: ${name}\ndescription: ${name}\n${front}---\n\nWork.\n`);
  };
  try {
    agent("lead", "tools: [read]\nagents: [editor]\nsubagents: [researcher, ghost]\n");
    agent("researcher", "tools: [read]\n");
    agent("editor", "");
    const g = buildWorkspaceGraph("default", ws);
    const edge = (kind: string) => g.links.filter((l) => l.kind === kind).map((l) => `${String(l.source).split(":").pop()}→${String(l.target).split(":").pop()}`);
    assert.deepEqual(edge("delegate"), ["lead→researcher"]);
    assert.deepEqual(edge("consult"), ["lead→editor"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
