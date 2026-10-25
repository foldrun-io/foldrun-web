// GET    /api/assistant/conversations/<id>  one conversation, whole:
//        { id, workspace, title, messages: [{ role, content, meta? }], files, createdAt, updatedAt }
// DELETE /api/assistant/conversations/<id>  delete it.
//
// Only its owner's: anyone else's id answers 404, the same as none.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { deleteConversation, getConversation } from "@/platform/assistant/conversations";
import { ownerOf } from "@/platform/assistant/jobs";
import { scopeAllows } from "@/platform/scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const { id } = await ctx.params;
    const c = await getConversation(tenant, ownerOf(actor), id);
    if (!c || !scopeAllows(actor.workspaces, c.workspace)) return NextResponse.json({ error: "no such conversation" }, { status: 404 });
    const { owner: _owner, ...shown } = c;
    void _owner;
    return NextResponse.json(shown);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const { id } = await ctx.params;
    const c = await getConversation(tenant, ownerOf(actor), id);
    if (!c || !scopeAllows(actor.workspaces, c.workspace)) return NextResponse.json({ error: "no such conversation" }, { status: 404 });
    await deleteConversation(tenant, ownerOf(actor), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
