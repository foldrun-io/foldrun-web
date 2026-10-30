// POST /api/workspaces/<ws>/flows/draft { description, flow? }
//
// A model drafts a flow file (and any agent files it needs) from a sentence;
// the answer is checked with the deploy's own checks and repaired once.
// Returns { files: [{ path, content, before, sha256 }], issues, repaired,
// notes } and WRITES NOTHING: the dashboard saves the files through the
// source PUT after a person confirms. See server/flow-draft.ts.
//
// `draft` is a static segment beside flows/[flow], so it would shadow a flow
// that happens to be named "draft". Anything that is not a draft request —
// a POST without `description`, a PATCH, a DELETE — is handed to the
// [flow] route as that flow's edit, so such a flow stays editable.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { draftFlow } from "@/server/flow-draft";
import * as flowRoute from "../[flow]/route";
import { idempotent } from "@/server/idempotency";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workspace: string }> };

const asFlow = async (ctx: Ctx) => ({ params: Promise.resolve({ ...(await ctx.params), flow: "draft" }) });
// The draft POST already answers once per Idempotency-Key; the [flow] edit it
// hands on to must not claim the same key again (it would find it pending).
const again = (req: NextRequest, body: string) => {
  const headers = new Headers(req.headers);
  headers.delete("idempotency-key");
  return new NextRequest(req.url, { method: req.method, headers, body: body || undefined });
};

async function postOnce(req: NextRequest, ctx: Ctx) {
  try {
    // Drafting reads the workspace and proposes writes to it: an editor's
    // job, so a viewer's key is refused before any model is called — and a
    // step appended to a flow named "draft" asks the same.
    const { tenant } = await requirePermission(req, "workspace:write");
    const text = await req.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as { description?: unknown; flow?: unknown };
    if (body.description === undefined) return flowRoute.POST(again(req, text), await asFlow(ctx));

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

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return flowRoute.DELETE(req, await asFlow(ctx));
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
