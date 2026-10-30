import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { startingFiles } from "@/server/starters";
import { errorResponse, requirePermission, actorOf, refuse } from "@/server/api";
import { assertSafeName, workspaceDir, writeWorkspaceFile } from "@/lib/store";
import { KINDS, type Kind } from "@/lib/kinds";
import { idempotent } from "@/server/idempotency";

// Create any workspace document — at workspace scope, or inside one agent.
//
// Agents, flows and evals also have their own REST collections; those are the
// documented API and stay. This one takes the kind as a field, which is what
// lets a single New button serve every noun.
//
// This endpoint exists because creation was the one path where the dashboard
// wrote the *content* as well as the name: it built a template in the browser
// and PUT it to /files. So the same skill started life differently depending
// on which button made it, and nothing but care kept the two in step. The
// server owns every template now, all of them from KINDS.

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const { workspace } = await ctx.params;
    const body = (await req.json()) as {
      kind?: string;
      name?: string;
      agent?: string;
      template?: string;
      /** Which language, when the shape is a script tool. */
      language?: string;
    };

    const kind = body.kind as Kind | undefined;
    if (!kind || !(kind in KINDS)) {
      return refuse(`expected kind to be one of ${Object.keys(KINDS).join(", ")}`, 400);
    }
    const meta = KINDS[kind];
    if (!body.name) return refuse("expected { name }", 400);
    assertSafeName(body.name, meta.one);

    if (!meta.scopes.includes("workspace")) {
      return refuse(`a ${meta.one} does not live in a workspace`, 400);
    }

    // An agent-scoped document lives under that agent, which is the whole of
    // what "agent scope" means on disk.
    // "Start from" — see the account library route.
    const starters = startingFiles(kind, body.name, body.template, body.language);
    let rel = starters[0].file;
    if (body.agent) {
      if (!meta.scopes.includes("agent")) {
        return refuse(`a ${meta.one} belongs to the workspace, not to one agent`, 400);
      }
      assertSafeName(body.agent, "agent");
      rel = `agents/${body.agent}/${rel}`;
    }

    // An agent-scoped document is prefixed; a tool folder writes every file
    // it starts as, not just its manifest.
    const prefix = rel === starters[0].file ? "" : rel.slice(0, rel.length - starters[0].file.length);
    // Creating over something that exists is not creating. Making a tool
    // again in a different language overwrote the definition and left the
    // previous program beside it — an orphaned run.mjs nothing referenced,
    // beside the run.py that `run:` now named.
    const clash = starters.find((f) =>
      fs.existsSync(path.join(workspaceDir(tenant, workspace), prefix + f.file)),
    );
    if (clash) {
      return refuse(`${prefix + clash.file} already exists — pick another name`, 409);
    }
    const by = await actorOf(req);
    for (const f of starters) writeWorkspaceFile(tenant, workspace, prefix + f.file, f.content, { by });
    return NextResponse.json({ ok: true, path: rel, type: meta.docType });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
