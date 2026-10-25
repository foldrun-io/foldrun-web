// One issue: read it, or act on it — acknowledge, snooze, resolve, reopen
// (FOL-54 step 3). Each act is kept in the issue's history with who did it.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller, requirePermission, ApiError } from "@/server/api";
import { accountIssues } from "@/server/issues";
import { actOnIssue } from "@/platform/issues";
import { snoozeMs, type IssueAction } from "@/lib/issues";

export const dynamic = "force-dynamic";

const ACTIONS: IssueAction[] = ["acknowledge", "snooze", "resolve", "reopen"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requireCaller(req);
    const issue = (await accountIssues(tenant, actor.workspaces)).find((i) => i.id === id);
    if (!issue) throw new ApiError(`no issue "${id}"`, 404);
    return NextResponse.json({ issue });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant, actor } = await requirePermission(req, "run:start");
    const body = (await req.json().catch(() => null)) as { action?: string; until?: string; for?: string; times?: number; note?: string } | null;
    const action = body?.action as IssueAction;
    if (!ACTIONS.includes(action)) throw new ApiError(`action takes ${ACTIONS.join(", ")}`, 400);
    // Only an issue this caller can see; a platform issue is the account's,
    // so a member given some desks may read it but not close it for everyone.
    const issue = (await accountIssues(tenant, actor.workspaces)).find((i) => i.id === id);
    if (!issue) throw new ApiError(`no issue "${id}"`, 404);
    if (issue.kind === "platform" && actor.workspaces !== null) throw new ApiError("a platform issue is the account's — it needs access to every workspace", 403);
    let until: string | undefined;
    let untilCount: number | undefined;
    if (action === "snooze") {
      const ms = typeof body?.for === "string" ? snoozeMs(body.for) : null;
      until = ms !== null ? new Date(Date.now() + ms).toISOString() : typeof body?.until === "string" ? body.until : undefined;
      // `times`: until it happens that many more times (FOL-72 step 7).
      if (body?.times !== undefined) {
        if (!Number.isInteger(body.times) || body.times < 1 || body.times > 1000) throw new ApiError("times is a whole number from 1 to 1000", 400);
        untilCount = body.times;
      }
      if (until !== undefined && !(Date.parse(until) > Date.now())) throw new ApiError("a snooze's `until` must be in the future", 400);
      if (until === undefined && untilCount === undefined) throw new ApiError("a snooze takes `for` (30m, 4h, 1d, 1w), a future `until`, or `times` (until it happens that many more times)", 400);
    }
    await actOnIssue(tenant, id, { action, by: actor.name, until, untilCount, note: typeof body?.note === "string" ? body.note : undefined });
    const after = (await accountIssues(tenant, actor.workspaces)).find((i) => i.id === id) ?? issue;
    return NextResponse.json({ issue: after });
  } catch (err) {
    return errorResponse(err);
  }
}
