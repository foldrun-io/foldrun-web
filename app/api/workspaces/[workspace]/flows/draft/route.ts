// POST /api/workspaces/<ws>/flows/draft { description, flow? }
//
// A model drafts a flow file (and any agent files it needs) from a sentence;
// the answer is checked with the deploy's own checks and repaired once.
// Returns { files: [{ path, content, before, sha256 }], issues, repaired,
// notes } and WRITES NOTHING: the dashboard saves the files through the
// source PUT after a person confirms. See server/flow-draft.ts.
//
// `draft` is a static segment beside flows/[flow], so it would shadow a flow
// that happens to be named "draft". A PATCH is handed to the [flow] route as
// that flow's edit, so such a flow stays editable. The older step POST and
// DELETE went on 5 Nov 2026 (FOL-75): a DELETE here answers 410, pointing at
// PATCH { edit }.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { draftFlow } from "@/server/flow-draft";
import * as flowRoute from "../[flow]/route";
import { idempotent } from "@/server/idempotency";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

const asFlow = async (ctx: Ctx) => ({ params: Promise.resolve({ ...(await ctx.params), flow: "draft" }) });
async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    // Drafting reads the workspace and proposes writes to it: an editor's
    // job, so a viewer's key is refused before any model is called — and a
    // step appended to a flow named "draft" asks the same.
    const { tenant } = await requirePermission(req, "workspace:write");
    const text = await req.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as { description?: unknown; flow?: unknown };
    if (body.description === undefined) return refuse('expected { description, flow? } — adding a step to a flow named draft is PATCH { edit: { op: "insert" } }', 400);

    const { workspace } = await ctx.params;
    if (typeof body.description !== "string") return refuse("expected { description, flow? }", 400);
    const result = await draftFlow(tenant, workspace, {
      description: body.description,
      flow: typeof body.flow === "string" && body.flow ? body.flow : null,
    });
    return NextResponse.json({ ok: result.issues.every((i) => i.level !== "error"), ...result });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return flowRoute.PATCH(req, await asFlow(ctx));
}

// Gone (FOL-75, sunset 5 Nov 2026): removing a step is PATCH { edit }.
export async function DELETE() {
  return refuse('removing a step is PATCH { edit: { op: "remove", step } } — this DELETE went on 5 Nov 2026', 410);
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
