import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, actorOf, requirePermission, refuse } from "@/server/api";
import { createHash } from "node:crypto";
import { readWorkspaceFile, writeWorkspaceFile, deleteWorkspacePath, listWorkspaceFiles, renameWorkspaceFile, assertEditablePath } from "@/lib/store";
import { saveCheck } from "@/server/checks";
import { assertMayChangeWorkspacePolicy, auditPolicyEvents } from "@/server/workspace-policy";

/** The bytes a reader saw, as a short name: what `ifMatch` on a write
 *  compares against, so a restore or a save from a stale page is refused
 *  instead of overwriting a change made since. */
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

async function tenantOf(req: NextRequest) {
  return await requireTenant(req);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await tenantOf(req);
    const rel = req.nextUrl.searchParams.get("path");
    if (!rel) return NextResponse.json({ files: listWorkspaceFiles(tenant, workspace) });
    const content = readWorkspaceFile(tenant, workspace, rel);
    return NextResponse.json({ path: rel, content, sha256: sha256(content) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    // Refuse before reading the body: a caller who may not do this learns
    // that, not what the body should have looked like.
    await requirePermission(req, "workspace:write");
    const { workspace } = await ctx.params;
    const body = (await req.json()) as { path?: string; content?: string; message?: string; ifMatch?: unknown; check?: unknown };
    if (!body.path || typeof body.content !== "string") {
      return refuse("expected { path, content, message?, ifMatch?, check? }", 400);
    }
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    // Every await before the check, so nothing lands between the check and
    // the synchronous write below (Codex review, FOL-112).
    const by = await actorOf(req);
    // AGENTS.md's policy keys (budget, notify, network_enforce…) are an
    // admin's on this path too — server/workspace-policy.ts (30 Oct 2026).
    const policyEvents = assertMayChangeWorkspacePolicy(actor, tenant, workspace, [{ path: body.path, content: body.content }], "merge");
    // ifMatch: the sha256 GET answered when the caller read the file. Checked
    // and written with nothing in between (both synchronous), so a change
    // that landed after the read is refused, not silently overwritten.
    // `ifMatch: null` says the caller saw no file there: one created since
    // is refused the same way.
    if (body.ifMatch !== undefined) {
      let current: string | null = null;
      try {
        current = readWorkspaceFile(tenant, workspace, body.path);
      } catch {
        current = null;
      }
      const now = current === null ? null : sha256(current);
      if (body.ifMatch === null ? now !== null : typeof body.ifMatch !== "string" || now !== body.ifMatch) {
        return NextResponse.json(
          { error: `${body.path} changed since it was loaded — reload to see the change, then try again`, sha256: now },
          { status: 409 },
        );
      }
    }
    // FOL-57: the deploy's checks on the workspace as it would be with this
    // file, answered as `issues` with every save. With `check: true` (the
    // dashboard editor sends it) an error a deploy would refuse is refused
    // here too — saved, it is live at once — and nothing is written. Opt-in,
    // so a caller written before this saves as it always did; leaving it out
    // is the editor's "Save anyway". Warnings never refuse.
    const issues = saveCheck(tenant, workspace, body.path, body.content);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length && body.check === true) {
      return NextResponse.json(
        {
          error: `${body.path} did not check out — ${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}. Nothing was saved; fix it, or save it anyway`,
          issues,
        },
        { status: 422 },
      );
    }
    // `message` rides the revision — what the CLI's --message and a
    // commit message are for: the why, beside the who.
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 200) : "";
    writeWorkspaceFile(tenant, workspace, body.path, body.content, {
      by,
      ...(message ? { message } : {}),
    });
    await auditPolicyEvents(policyEvents, actor.name, tenant);
    return NextResponse.json({ ok: true, path: body.path, sha256: sha256(body.content), issues });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Rename: { from, to }. Both paths pass the same gate as a write. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    // Refuse before reading the body: a caller who may not do this learns
    // that, not what the body should have looked like.
    await requirePermission(req, "workspace:write");
    const { workspace } = await ctx.params;
    const body = (await req.json()) as { from?: string; to?: string };
    if (!body.from || !body.to) {
      return refuse("expected { from, to }", 400);
    }
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    // A file moved arrives with whatever it holds: moved into flows/ with
    // `a2a:`, it is as much a publication as writing it there
    // (server/workspace-policy.ts). The destination is read the way the
    // rename itself reads it — assertEditablePath, which normalises
    // `./flows/x.md` and `flows//x.md` to flows/x.md — so no spelling of
    // the path slips past the check and still lands in flows/.
    let dest: string | null = null;
    try {
      dest = assertEditablePath(body.to).replaceAll("\\", "/");
    } catch {
      dest = null; // not a path the rename takes: it refuses with the reason
    }
    const by = await actorOf(req);
    let policyEvents: ReturnType<typeof assertMayChangeWorkspacePolicy> = [];
    if (dest !== null) {
      let content: string | null = null;
      try {
        content = readWorkspaceFile(tenant, workspace, body.from);
      } catch {
        content = null; // nothing there: the rename says so itself
      }
      // The source goes as the destination arrives: moving AGENTS.md (its
      // hooks:, its network:) or an agent file away changes what the agents
      // behind a published flow may reach as surely as a write (FOL-112).
      if (content !== null) policyEvents = assertMayChangeWorkspacePolicy(actor, tenant, workspace, [{ path: dest, content }], "merge", { removed: [body.from] });
    }
    renameWorkspaceFile(tenant, workspace, body.from, body.to, { by });
    await auditPolicyEvents(policyEvents, actor.name, tenant);
    return NextResponse.json({ ok: true, path: body.to });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    // Refuse before reading the body: a caller who may not do this learns
    // that, not what the body should have looked like.
    await requirePermission(req, "workspace:write");
    const { workspace } = await ctx.params;
    const body = (await req.json()) as { path?: string };
    if (!body.path) return refuse("expected { path }", 400);
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    const by = await actorOf(req);
    // Removing a file can widen too: AGENTS.md's hooks: or network:, or an
    // agent file that leaves its Claude Code twin in use (FOL-112).
    const policyEvents = assertMayChangeWorkspacePolicy(actor, tenant, workspace, [], "merge", { removed: [body.path] });
    deleteWorkspacePath(tenant, workspace, body.path, { by });
    await auditPolicyEvents(policyEvents, actor.name, tenant);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
