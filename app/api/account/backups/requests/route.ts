// Ask the operator to restore what an account cannot restore itself.
//
//   GET                       this account's requests, newest first
//   POST { what, target, workspace?, backupId?, note? }
//        what: "runs" | "state" | "storage" | "everything"
//        target: the point in time wanted, as the person puts it
//
// Runs, state/, storage and the database's records come back only from a
// nightly archive, and that restore replaces a volume and a database the
// account shares with others — an operator's job, by design (the key that
// opens the archive's sealed half is not on the server). So this records the
// ask, mails the operator and audit-logs it; it restores nothing.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requirePermission, actorOf, errorResponse, ApiError, assertWorkspaceScope } from "@/server/api";
import { createRestoreRequest, listRestoreRequests, markRestoreRequestNotified } from "@/platform/backups";
import { platformAccount } from "@/platform/admin";
import { ownerOf } from "@/server/users";
import { sendRestoreRequestNotice } from "@/server/email";
import { audit } from "@/server/audit";
import { listWorkspaces } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { idempotent } from "@/server/idempotency";

export const dynamic = "force-dynamic";

const WHAT = new Set(["runs", "state", "storage", "everything"]);

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    // Scoped like POST: a request for a workspace the caller was not given is
    // not listed, nor an account-wide one (workspace null) to a scoped caller.
    const requests = (await listRestoreRequests(tenant)).filter((r) =>
      r.workspace ? scopeAllows(actor.workspaces, r.workspace) : actor.workspaces === null,
    );
    return NextResponse.json({ requests });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key: a retried ask is not a second mail. */
export async function POST(req: NextRequest) {
  return idempotent(req, () => requestPost(req));
}

async function requestPost(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const what = typeof body.what === "string" ? body.what : "";
    if (!WHAT.has(what)) throw new ApiError(`expected what: ${[...WHAT].join(" | ")}`, 400);
    const target = typeof body.target === "string" ? body.target.trim().slice(0, 100) : "";
    if (!target) throw new ApiError("expected target: the date and time to restore to", 400);
    const workspace = typeof body.workspace === "string" && body.workspace ? body.workspace : null;
    if (workspace) {
      assertWorkspaceScope(actor, workspace);
      if (!listWorkspaces(tenant).some((w) => w.name === workspace)) throw new ApiError(`no workspace "${workspace}"`, 404);
    } else if (actor.workspaces !== null) {
      throw new ApiError("a restore of the whole account needs access to every workspace — name one you were given", 403);
    }
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
    const backupId = typeof body.backupId === "string" ? body.backupId.slice(0, 200) : null;
    const by = await actorOf(req);

    const request = await createRestoreRequest({ tenant, workspace, target, backupId, what, note, by });
    await audit("backup.restore_requested", { actor: by, tenant, subject: request.id, detail: { workspace, what, target, backupId } });
    const admin = await ownerOf(platformAccount());
    const mail = admin?.email
      ? await sendRestoreRequestNotice(platformAccount(), admin.email, { ...request })
      : ({ ok: false, error: "no operator to tell" } as const);
    if (!mail.ok) console.error(`[foldrun] restore request ${request.id} for ${tenant}: operator not mailed — ${mail.error}`);
    await markRestoreRequestNotified(request.id, mail.ok);
    return NextResponse.json({ ok: true, request: { ...request, notified: mail.ok } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
