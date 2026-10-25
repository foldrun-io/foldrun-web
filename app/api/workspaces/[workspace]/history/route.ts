// Every change to a workspace, newest first — and one change in full.
//
//   GET ?path=<file>      revisions that touched that file
//   GET ?id=<revision>    one revision: before, after, and a line diff, so
//                         the browser never needs the diff code (which lives
//                         in core beside node:fs and cannot ship to a client)
//   GET ?id=&path=        that revision, narrowed to one file's diff

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { requireTenant, errorResponse } from "@/server/api";
import { intParam } from "@/server/query";
import { workspaceDir } from "@/lib/store";
import { diffLines, listRevisions, readRevision } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return NextResponse.json({ error: `no workspace "${workspace}"` }, { status: 404 });
    }
    const id = req.nextUrl.searchParams.get("id");
    const forPath = req.nextUrl.searchParams.get("path") ?? undefined;

    if (id) {
      const rev = readRevision(tenant, workspace, id);
      if (!rev) return NextResponse.json({ error: "no such revision" }, { status: 404 });
      const files = (forPath ? rev.files.filter((f) => f.path === forPath) : rev.files).map((f) => ({
        ...f,
        diff: diffLines(f.before ?? "", f.after ?? ""),
      }));
      return NextResponse.json({ ...rev, files });
    }

    const limit = intParam(req.nextUrl.searchParams.get("limit"), 100, 1, 500);
    return NextResponse.json({ revisions: listRevisions(tenant, workspace, { forPath, limit }) });
  } catch (err) {
    return errorResponse(err);
  }
}
