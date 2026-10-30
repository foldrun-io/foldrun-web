// Everything an editor could suggest for this workspace. Names only — secrets
// are listed by name and never by value, same as the settings page.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireCaller, errorResponse } from "@/server/api";
import { workspaceDir, listAgents, listFlows, workspaceTools } from "@/lib/store";
import { listStorage, requireWorkspace } from "@/lib/storage";
import { libraryTools, libraryDir } from "@/lib/library";
import { listSecrets } from "@/lib/secrets";
import { readBundle } from "@/lib/okf";
import { linkableDocs } from "@/lib/linkable";
import { discoverSkills } from "@/lib/runner";
import type { Vocabulary } from "@/lib/completions";
import { configMatter } from "@/lib/matter";
import { parseProvider, accountDir } from "@/lib/store";
import { readCatalog, refreshCatalogSoon, catalogCompletions } from "@/lib/catalog";

const listScripts = (dir: string, prefix: string) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => {
      try {
        return fs.statSync(path.join(dir, rel)).isFile();
      } catch {
        return false;
      }
    })
    .map((rel) => `${prefix}${rel}`);
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    // A name with no workspace is a 404 as on its siblings (30 Oct 2026),
    // not an empty answer that reads as "nothing here".
    requireWorkspace(tenant, workspace);
    const dir = workspaceDir(tenant, workspace);
    const agents = listAgents(tenant, workspace).map((a) => a.name);

    // What [[ ]] can reach beyond agents and flows. Names are what a person
    // types; the runner turns them into real paths at prompt time. Capped —
    // a completion menu past a few hundred rows is a search problem, and
    // the type-ahead filter handles the rest.
    const files = (() => {
      try {
        return listStorage(tenant, workspace);
      } catch {
        return []; // single-workspace mode: files/ is a plain folder
      }
    })();
    // One definition, in core, shared with the resolver — see linkable.ts.
    // This list used to be built here and offered the file store as
    // `files/…` while the runner indexed it as `storage/…`, so the
    // suggestion the editor gave was one the run could not resolve.
    const docs = linkableDocs(dir, files);

    // Skills from every scope, deduped — the same set an agent would see.
    const skills = new Set<string>();
    for (const base of [dir, libraryDir(tenant)]) {
      for (const s of discoverSkills(base)) skills.add(s.name);
    }
    for (const agent of agents) {
      for (const s of discoverSkills(path.join(dir, "agents", agent))) skills.add(s.name);
    }

    // Every `type:` already in this workspace's OKF bundles, at any scope.
    const types = new Set<string>();
    for (const kind of ["knowledge", "memory"]) {
      for (const base of [dir, libraryDir(tenant)]) {
        for (const doc of readBundle(path.join(base, kind))) {
          if (doc.type) types.add(doc.type);
        }
      }
      for (const agent of agents) {
        for (const doc of readBundle(path.join(dir, "agents", agent, kind))) {
          if (doc.type) types.add(doc.type);
        }
      }
    }

    const vocab: Vocabulary = {
      agents,
      flows: listFlows(tenant, workspace).map((f) => f.name),
      skills: [...skills].sort(),
      tools: [
        ...new Set([
          ...Object.keys(libraryTools(tenant)),
          ...Object.keys(workspaceTools(tenant, workspace)),
        ]),
      ].sort(),
      // The account store's names to a caller with every workspace only,
      // as GET /api/secrets lists them (30 Oct 2026).
      secrets: listSecrets(tenant, workspace).filter((s) => actor.workspaces === null || s.scope === "workspace").map((s) => s.name),
      scripts: [
        ...listScripts(path.join(dir, "scripts"), "workspace/scripts/"),
        ...listScripts(libraryDir(tenant, "scripts"), "account/scripts/"),
        ...agents.flatMap((a) => listScripts(path.join(dir, "agents", a, "scripts"), "scripts/")),
      ].sort(),
      types: [...types].sort(),
      docs,
    };

    // The gateway's catalogue, when one is declared — workspace over account,
    // like the runner resolves it. Serve whatever the cache holds and refresh
    // it in the background: an autocomplete request must never wait on
    // someone else's API.
    const front = (base: string) => {
      try {
        return configMatter(fs.readFileSync(path.join(base, "AGENTS.md"), "utf8")).data as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const provider = parseProvider(front(dir).provider ?? front(accountDir(tenant)).provider);
    if (provider?.baseUrl) {
      vocab.models = catalogCompletions(readCatalog(provider.baseUrl));
      refreshCatalogSoon(provider.baseUrl);
    }
    return NextResponse.json(vocab);
  } catch (err) {
    return errorResponse(err);
  }
}
