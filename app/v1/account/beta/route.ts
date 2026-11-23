// The account's beta: whether it gets beta features before everyone
// (owner, 13 Nov 2026). In the beta, every flag marked beta is on for the
// account ahead of its rollout; an operator's override still decides first
// (foldrun-platform flags.ts). Stored as the account's own `beta-program`
// flag decision — the one flag an account sets for itself.
//
//   GET                  { beta, flags: [{ name, description, on, source }] } — the beta flags as they stand for this account
//   PUT { beta: bool }   join or leave (an admin of every workspace); audited
//                        account.beta_joined | account.beta_left

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requirePermission, errorResponse, ApiError, actorOf } from "@/server/api";
import { audit } from "@/server/audit";
import { betaProgram, effectiveFlags, setBetaProgram } from "@/platform/flags";

async function view(tenant: string) {
  const flags = (await effectiveFlags(tenant)).filter((f) => f.beta).map(({ name, description, on, source }) => ({ name, description, on, source }));
  return { beta: await betaProgram(tenant), flags };
}

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireCaller(req);
    return NextResponse.json(await view(tenant));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    // The whole account's choice: a caller given some workspaces may not make it.
    if (actor.workspaces !== null) throw new ApiError("joining the beta changes the whole account — it needs access to every workspace", 403);
    const body = (await req.json().catch(() => null)) as { beta?: unknown } | null;
    if (typeof body?.beta !== "boolean") throw new ApiError("send { beta: true } to join the beta, { beta: false } to leave it", 400);
    const by = (await actorOf(req)) || actor.name;
    const changed = await setBetaProgram(tenant, body.beta, by);
    if (changed) await audit(body.beta ? "account.beta_joined" : "account.beta_left", { actor: by, tenant, subject: tenant });
    return NextResponse.json({ ...(await view(tenant)), changed });
  } catch (err) {
    return errorResponse(err);
  }
}
