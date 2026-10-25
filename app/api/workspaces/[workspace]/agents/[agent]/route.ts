// PATCH one agent's team, line by line — what the flow canvas's docks post.
//
//   { list: { key: "subagents" | "agents" | "tools", name, action: "add" | "remove" } }
//   { set:  { key: "description" | "sandbox", value } }   — sandbox: own | parent
//   { network: { level?, allow?, defaults? } | null }   — the sites its sandbox may reach; null inherits
//
// A whole-file PUT through /source would do the same write, but the client
// would have to read the file, edit it and send it back, and a second edit in
// between would be lost. Here the read and the write are one request, and
// the edit is core's (flow-patterns.ts): only the lines of that one key
// change, so comments, key order and the prose stay as the author wrote them.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { errorResponse, requirePermission, actorOf } from "@/server/api";
import { workspaceDir, assertSafeName, writeWorkspaceFile } from "@/lib/store";
import { editFrontmatterList, setFrontmatterScalar, TEAM_LIST_KEYS } from "@/lib/flow-patterns";
import { readNetwork, setNetworkSetting } from "@/lib/network";
import { guardEdit, readFront, type Expect } from "@/lib/frontmatter-guard";
import { refNames } from "@/lib/refs";
import { configMatter } from "@/lib/matter";
import { isDeepStrictEqual } from "node:util";

const SCALAR_KEYS = ["description", "sandbox"];
/** The values a scalar may take, where the schema fixes them. */
const SCALAR_VALUES: Record<string, readonly string[]> = { sandbox: ["own", "parent"] };

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ workspace: string; agent: string }> }) {
  try {
    const { workspace, agent } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    assertSafeName(agent, "agent");
    const body = (await req.json().catch(() => ({}))) as {
      list?: { key?: string; name?: string; action?: string };
      set?: { key?: string; value?: string };
      network?: unknown;
    };
    const rel = `agents/${agent}/agent.md`;
    const file = path.join(workspaceDir(tenant, workspace), rel);
    if (!fs.existsSync(file)) return NextResponse.json({ error: `agent ${agent} not found` }, { status: 404 });
    const raw = fs.readFileSync(file, "utf8");

    let next: string;
    let message: string;
    if (body.list) {
      const { key, name, action } = body.list;
      if (!key || !(TEAM_LIST_KEYS as readonly string[]).includes(key)) {
        return NextResponse.json({ error: `list key is one of ${TEAM_LIST_KEYS.join(", ")}` }, { status: 400 });
      }
      if (action !== "add" && action !== "remove") return NextResponse.json({ error: "action is add or remove" }, { status: 400 });
      if (!name || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) return NextResponse.json({ error: "expected a name" }, { status: 400 });
      if (key !== "tools") assertSafeName(name, "agent");
      next = editFrontmatterList(raw, key, name, action);
      message = `${action === "add" ? "added" : "removed"} ${name} ${action === "add" ? "to" : "from"} ${key}: on the canvas`;
    } else if (body.set) {
      const { key, value } = body.set;
      if (!key || !SCALAR_KEYS.includes(key)) return NextResponse.json({ error: `set key is one of ${SCALAR_KEYS.join(", ")}` }, { status: 400 });
      if (typeof value !== "string" || !value.trim()) return NextResponse.json({ error: "expected a value" }, { status: 400 });
      const allowed = SCALAR_VALUES[key];
      if (allowed && !allowed.includes(value.trim())) return NextResponse.json({ error: `${key} is one of ${allowed.join(", ")}` }, { status: 400 });
      next = setFrontmatterScalar(raw, key, value);
      message = `set ${key}: on the canvas`;
    } else if (body.network !== undefined) {
      // Read by the same reader a run uses, so what is written is what runs.
      if (body.network === null) {
        next = setNetworkSetting(raw, null);
        message = "network: inherits";
      } else {
        const { setting, problems } = readNetwork(body.network);
        if (problems.length || !setting) return NextResponse.json({ error: problems.join(" ") || "expected { level?, allow?, defaults? }" }, { status: 400 });
        next = setNetworkSetting(raw, setting);
        message = `network: ${JSON.stringify(setting)}`;
        // What a run will read is what was asked for.
        if (!isDeepStrictEqual(readNetwork(configMatter(next).data.network).setting, setting)) {
          return NextResponse.json({ error: "not saved — network: would not read back as written. Edit the file itself, or write its blocks one key per line" }, { status: 409 });
        }
      }
    } else {
      return NextResponse.json({ error: "expected { list }, { set } or { network }" }, { status: 400 });
    }
    // Read back as a run reads it: refused (409, nothing written) if it
    // would not parse, would touch another key, would double one into its
    // block, or would not read as asked — worked out here from what was
    // there, not from the writer's output.
    const was = readFront(raw) ?? {};
    let expect: Record<string, Expect>;
    if (body.list) {
      const { key, name, action } = body.list as { key: string; name: string; action: "add" | "remove" };
      const want = new Set(refNames(was[key]));
      if (action === "add") want.add(name);
      else want.delete(name);
      expect = { [key]: (v: unknown) => { const got = new Set(refNames(v)); return got.size === want.size && [...want].every((n) => got.has(n)); } };
    } else if (body.set) {
      const { key, value } = body.set as { key: string; value: string };
      // Written on one line (flow-patterns yamlScalar), so compared so.
      const flat = (t: string) => t.replace(/\s+/g, " ").trim();
      expect = { [key]: (v: unknown) => flat(String(v)) === flat(value) };
    } else {
      expect = body.network === null ? { network: null } : {};
    }
    next = guardEdit(raw, next, Object.keys(expect).length ? Object.keys(expect) : ["network"], expect);
    if (next !== raw) writeWorkspaceFile(tenant, workspace, rel, next, { by: await actorOf(req), message });
    return NextResponse.json({ ok: true, changed: next !== raw });
  } catch (err) {
    return errorResponse(err);
  }
}
