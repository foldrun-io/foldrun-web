// The account's issues (FOL-54 step 3): what went wrong, grouped, kept open
// until a person resolves it — see core issues.ts for what makes an issue.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller, ApiError } from "@/server/api";
import { accountIssues, filterIssues, ISSUE_STATUSES, type IssueFilter } from "@/server/issues";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const q = req.nextUrl.searchParams;
    const status = (q.get("status") ?? "active") as IssueFilter;
    if (!ISSUE_STATUSES.includes(status)) throw new ApiError(`status takes ${ISSUE_STATUSES.join(", ")}`, 400);
    const issues = filterIssues(await accountIssues(tenant, actor.workspaces), status, q.get("workspace"));
    return NextResponse.json({ issues });
  } catch (err) {
    return errorResponse(err);
  }
}
