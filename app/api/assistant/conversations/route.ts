// GET /api/assistant/conversations?workspace=&q=&limit=
//
// The assistant conversations of whoever asks — a person's own, or a key's
// own — newest first, across the workspaces they can see. `q` searches the
// titles and every message; `workspace` narrows to one. Each is
// { id, workspace, title, updatedAt, messages, unsaved }. Read one whole at
// /api/assistant/conversations/<id>; carry it on by sending its id as
// `conversation` to POST /api/workspaces/<ws>/assistant.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { listConversations } from "@/platform/assistant/conversations";
import { ownerOf } from "@/platform/assistant/jobs";
import { scopeAllows } from "@/platform/scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const url = req.nextUrl;
    const workspace = url.searchParams.get("workspace");
    if (workspace && !scopeAllows(actor.workspaces, workspace)) {
      return NextResponse.json({ error: `no workspace "${workspace}"` }, { status: 404 });
    }
    const limitParam = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 200) : 50;
    const list = await listConversations(tenant, ownerOf(actor), { workspace, q: url.searchParams.get("q"), limit });
    // A key or member scoped to some workspaces sees those alone.
    return NextResponse.json({ conversations: list.filter((c) => scopeAllows(actor.workspaces, c.workspace)) });
  } catch (err) {
    return errorResponse(err);
  }
}
