import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { requireCaller, errorResponse } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import { listWorkspaces, listAgents, listFlows, listAllRunSummaries, workspaceTools, workspaceDir, runDisplayStatus } from "@/lib/store";
import { listLibrary, LIBRARY_KINDS } from "@/lib/library";
import { readBundle } from "@/lib/okf";
import { discoverSkills } from "@/lib/runner";
import { listHookDirs, readHookDef } from "@/lib/hooks";
import { rank, type FindHit } from "@/components/find-model";

// Everything in the account, findable by name: workspaces, agents, flows,
// tools, skills, knowledge, memory — in every workspace and on the shared
// shelf — and runs by id, flow or headline. Ranked by find-model.ts, the
// same rules the palette applies to its own page list, so one query reads
// the same wherever it is answered.
//
// Read off disk on every call, like the graph: the account is small enough
// that an index would be a second source of truth to keep honest.

const PER_KIND = 6;

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const qs = tenant !== "default" ? `tenant=${tenant}` : "";
    const first = qs ? `?${qs}` : "";
    const rest = qs ? `&${qs}` : "";
    const hits: FindHit[] = [];

    for (const w of listWorkspaces(tenant)) {
      const ws = w.name;
      if (!scopeAllows(actor.workspaces, ws)) continue;
      hits.push({
        kind: "workspace",
        title: ws,
        subtitle: w.description || `${w.agents} agent${w.agents === 1 ? "" : "s"} · ${w.flows} flow${w.flows === 1 ? "" : "s"}`,
        href: `/dashboard/${ws}${first}`,
      });
      // A query of a few letters is answered from names alone; reading every
      // agent of every workspace is for when there is something to match.
      if (!q) continue;
      for (const a of listAgents(tenant, ws)) {
        hits.push({
          kind: "agent",
          title: a.name,
          subtitle: a.description,
          workspace: ws,
          href: `/dashboard/${ws}/edit?path=${encodeURIComponent(`agents/${a.name}/agent.md`)}${rest}`,
        });
      }
      for (const f of listFlows(tenant, ws)) {
        hits.push({
          kind: "flow",
          title: f.name,
          subtitle: f.schedule ? `${f.trigger} · ${f.schedule}` : f.trigger,
          workspace: ws,
          href: `/dashboard/${ws}/edit?path=${encodeURIComponent(`flows/${f.file}`)}${rest}`,
        });
      }
      for (const [name, t] of Object.entries(workspaceTools(tenant, ws))) {
        hits.push({
          kind: "tool",
          title: name,
          subtitle: (t as { description?: string }).description ?? "",
          workspace: ws,
          href: `/dashboard/${ws}/assets?kind=tools${rest}`,
        });
      }
      const dir = workspaceDir(tenant, ws);
      for (const h of listHookDirs(path.join(dir, "hooks"))) {
        const def = readHookDef(h, "workspace");
        hits.push({ kind: "hook", title: path.basename(h), subtitle: "error" in def ? def.error : (def.description ?? def.on), workspace: ws, href: `/dashboard/${ws}/assets?kind=hooks${rest}` });
      }
      for (const s of discoverSkills(dir)) {
        hits.push({ kind: "skill", title: s.name, subtitle: s.description, workspace: ws, href: `/dashboard/${ws}/assets?kind=skills${rest}` });
      }
      for (const d of readBundle(path.join(dir, "knowledge"))) {
        hits.push({ kind: "knowledge", title: d.title, subtitle: d.description, workspace: ws, href: `/dashboard/${ws}/edit?path=${encodeURIComponent(`knowledge/${d.file}`)}${rest}` });
      }
      for (const d of readBundle(path.join(dir, "memory"))) {
        hits.push({ kind: "memory", title: d.title, subtitle: d.description, workspace: ws, href: `/dashboard/${ws}/edit?path=${encodeURIComponent(`memory/${d.file}`)}${rest}` });
      }
    }

    if (q) {
      for (const kind of LIBRARY_KINDS) {
        if (kind === "scripts") continue; // code, not a thing you look up by name
        const findKind: FindHit["kind"] = kind === "tools" ? "tool" : kind === "hooks" ? "hook" : kind === "skills" ? "skill" : kind;
        for (const e of listLibrary(tenant, kind)) {
          hits.push({ kind: findKind, title: e.name, subtitle: `shared · ${e.description}`, href: `/dashboard/library?kind=${kind}${rest}` });
        }
      }
      for (const r of listAllRunSummaries(tenant)) {
        if (!scopeAllows(actor.workspaces, r.workspace)) continue;
        const status = runDisplayStatus(r);
        hits.push({
          kind: "run",
          // The id is the title so a pasted id lands; the flow and headline
          // are the subtitle so "what did the nightly say" lands too.
          title: r.id,
          subtitle: [r.flow, r.summary?.trim()].filter(Boolean).join(" — "),
          workspace: r.workspace,
          status,
          href: `/dashboard/${r.workspace}/runs/${r.id}${rest.replace("&", "?")}`,
        });
      }
    }

    return NextResponse.json({ hits: rank(hits, q, PER_KIND) });
  } catch (err) {
    return errorResponse(err);
  }
}
