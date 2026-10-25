// Everything the account holds about itself, as one file the owner keeps.
//
//   GET /api/account/export   → foldrun-<account>-export.json
//
// The workspaces and what is in them, an index of every run, the members,
// and the whole ledger — the charge on each line, never the platform's
// provider cost behind it, which is not the customer's. The markdown
// itself is already theirs through `foldrun pull` and the source API; this
// is the part that lives only on the platform. Owner only: the ledger is
// money and the member list is people.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse } from "@/server/api";
import { listWorkspaces, listFlows, listAllRuns } from "@/lib/store";
import { listMembers } from "@/server/users";
import { readLedger } from "@/platform/ledger";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const caller = await requirePermission(req, "billing:manage");
    const tenant = caller.tenant;
    const workspaces = listWorkspaces(tenant).map((w) => ({ name: w.name, flows: listFlows(tenant, w.name).map((f) => f.name) }));
    const runs = listAllRuns(tenant).map((r) => ({
      id: r.id,
      workspace: r.workspace,
      flow: r.flow,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      summary: r.summary,
      ...(r.startedBy ? { startedBy: r.startedBy } : {}),
    }));
    const members = (await listMembers(tenant)).map((m) => ({ email: m.email, role: m.owner ? "owner" : m.role ?? null, workspaces: m.workspaces ?? null, since: m.createdAt }));
    const ledger = (await readLedger(tenant)).map(({ cost: _cost, agents: _agents, ...e }) => e);
    await audit("account.exported", { actor: caller.actor.name, tenant, detail: { runs: runs.length, ledger: ledger.length } });
    const body = { account: tenant, exportedAt: new Date().toISOString(), workspaces, members, runs, ledger };
    return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="foldrun-${tenant}-export.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
