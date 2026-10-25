// Would this delivery start this flow? The flow's `filter:` (core
// trigger-filter.ts) matched against a payload you hand it — the Test box on
// the Triggers page and `foldrun flow filter`. Nothing is started, recorded
// or charged: it reads the deployed flow and answers.
//
//   POST { payload }   → { flow, trigger, filter, match, reason }
//
// `payload` is what the trigger would deliver: a webhook's JSON body; for an
// email flow { from, to, subject, text }; a chained flow { run, flow,
// status, ending, verdict, summary }; a storage flow { by, paths }. A string
// is read as a webhook body would be — JSON, or no match.

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import { loadFlow } from "@/lib/runner";
import { assertSafeName } from "@/lib/store";
import { matchFilter, webhookFilterPayload, FILTERABLE_TRIGGERS } from "@/lib/trigger-filter";

export async function POST(req: NextRequest, ctx: { params: Promise<{ workspace: string; flow: string }> }) {
  try {
    const tenant = await requireTenant(req);
    const { workspace, flow: name } = await ctx.params;
    assertSafeName(name, "flow");
    const body = (await req.json().catch(() => null)) as { payload?: unknown } | null;
    if (!body || typeof body !== "object" || !("payload" in body)) {
      throw new ApiError("expected { payload } — the delivery to test, as JSON (or a webhook body as a string)", 400);
    }
    const flow = loadFlow(tenant, workspace, name);
    if (!flow) throw new ApiError(`flow ${name} not found`, 404);
    const payload = typeof body.payload === "string" ? webhookFilterPayload(body.payload) : body.payload;
    const verdict = flow.filter != null ? matchFilter(flow.filter, payload) : { match: true, reason: "this flow has no filter: — every delivery starts it" };
    return NextResponse.json({
      flow: flow.name,
      trigger: flow.trigger,
      filter: flow.filter,
      applies: (FILTERABLE_TRIGGERS as readonly string[]).includes(flow.trigger),
      ...verdict,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
