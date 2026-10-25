// Send one made-up run to the collector `telemetry:` names, and say what it
// answered — the proof a trace path works before a real run depends on it.
//
//   POST { workspace? }   → { ok, status?, error?, spans?, endpoint }
//
// The workspace's block when one is named (else the account's), with its
// header secrets filled from the vault as a real run's would be.

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, assertWorkspaceScope, errorResponse, ApiError } from "@/server/api";
import { telemetryConfig, sendTrace } from "@/platform/otel-export";
import type { RunRecord } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "workspace:manage");
    const body = (await req.json().catch(() => ({}))) as { workspace?: unknown };
    const workspace = typeof body.workspace === "string" && body.workspace ? body.workspace : null;
    if (workspace) assertWorkspaceScope(actor, workspace);
    else if (actor.workspaces !== null) throw new ApiError("the account's telemetry needs access to every workspace — name a workspace you were given", 403);
    const cfg = telemetryConfig(tenant, workspace);
    if (!cfg) throw new ApiError(`no telemetry: block in ${workspace ? `${workspace}'s or the account's` : "the account's"} AGENTS.md — set otlp: first`, 409);
    const now = Date.now();
    const at = (s: number) => new Date(now - 4000 + s * 1000).toISOString();
    const run = {
      id: `test-${now.toString(36)}`,
      flow: "foldrun-telemetry-test",
      status: "completed",
      startedAt: at(0),
      finishedAt: at(3),
      startedBy: actor.name,
      steps: [{
        agent: "telemetry-test", instruction: "", group: 1, optional: false, status: "completed", result: "ok", costUsd: 0, startedAt: at(0.5), finishedAt: at(3),
        calls: [{ id: "m1", n: 1, at: at(2), ms: 1000, model: "test", stop: "end_turn", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, tools: 1 }],
        events: [{ t: at(1), type: "tool", text: "test-tool", call: "c1", inCall: "m1" }, { t: at(1.5), type: "tool", text: "test-tool", call: "c1", ms: 500 }],
      }],
    } as unknown as RunRecord;
    const out = await sendTrace(tenant, workspace, run, cfg);
    return NextResponse.json({ ...out, endpoint: cfg.endpoint });
  } catch (err) {
    return errorResponse(err);
  }
}
