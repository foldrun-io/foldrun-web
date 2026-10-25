// What is backed up for this account, and when it last was.
//
//   GET   { policy, backups, last, requests, workspaces }
//
// The nightly backup is the operator's and covers every account in one
// archive (foldrun-infra dev/backup.sh); each archive the job verified is
// recorded with the accounts it holds, and this lists the ones holding this
// account. Each says whether it was encrypted before it left the server
// (`encrypted`, and the fingerprint of the key it was sealed to in
// `recipient`); `policy.encrypted` is the job's rule. Restoring one of
// those is the operator's job — ask with
// POST /api/account/backups/requests. What an account can restore itself is
// a workspace's source, from its own history: POST
// /api/workspaces/<ws>/restore.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { scopeAllows } from "@/platform/scope";
import { backupPolicy, listBackups, listRestoreRequests } from "@/platform/backups";
import { listWorkspaces } from "@/lib/store";
import { headRevision, listRevisions } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const backups = await listBackups(tenant);
    const workspaces = listWorkspaces(tenant)
      .filter((w) => scopeAllows(actor.workspaces, w.name))
      .map((w) => {
        // The newest revision with a snapshot — what a restore can reach.
        const head = headRevision(tenant, w.name)?.id ?? null;
        const latest = listRevisions(tenant, w.name, { limit: 1 })[0] ?? null;
        return {
          name: w.name,
          head,
          lastChange: latest ? { id: latest.id, at: latest.at, by: latest.by, message: latest.message } : null,
          history: Boolean(head),
        };
      });
    return NextResponse.json({
      policy: backupPolicy(),
      last: backups[0] ?? null,
      backups,
      // A scoped caller sees the requests for its workspaces; an account-wide
      // one (workspace null) only an unscoped caller — POST asks the same.
      requests: (await listRestoreRequests(tenant)).filter((r) =>
        r.workspace ? scopeAllows(actor.workspaces, r.workspace) : actor.workspaces === null,
      ),
      workspaces,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
