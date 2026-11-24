// One conversation of the project (FOL-264): name it, or take its name away.
// The name is kept with the project by the conversation's key, so a
// conversation moving between a person's computer and the cloud keeps one
// name; GET …/sessions lists it. Needs `run:start` — the right that works in
// a conversation.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { requireWorkspace } from "@/lib/storage";
import { jsonObject } from "@/server/body";
import { contextIdProblem, sessionNameProblem, setSessionName } from "@/lib/conversation";

type Ctx = { params: Promise<{ workspace: string; context: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { workspace, context } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    requireWorkspace(tenant, workspace);
    const problem = contextIdProblem(context);
    if (problem) return refuse(problem, 400);
    const body = (await jsonObject(req)) as { name?: unknown };
    if (!("name" in body)) return refuse("name: a few words, or null to take the name away", 400);
    if (body.name !== null) {
      const nameProblem = sessionNameProblem(body.name);
      if (nameProblem) return refuse(nameProblem, 400);
    }
    const named = setSessionName(tenant, workspace, context, body.name as string | null, `${actor.kind}:${actor.id}`);
    return NextResponse.json({ context, name: named?.name ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
