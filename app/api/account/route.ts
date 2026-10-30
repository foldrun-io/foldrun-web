import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, requireAccountWide, refuse } from "@/server/api";
import { accountDir } from "@/lib/store";
import { readAgentsMdKeys, setAgentsMdKeys } from "@/lib/agents-md";
import { defaultsPatch, defaultsOf, accountDefaultsFor } from "@/components/defaults-model";

// The account's defaults — what its AGENTS.md frontmatter sets for every
// workspace: a timezone for schedules, where to notify, a monthly cap.
//
//   GET            the current values — to a caller limited to some
//                  workspaces, notify:'s URL and telemetry: as `hidden: true`
//                  (accountDefaultsFor)
//   PATCH { … }    set some; null clears one. Edits the keys in place and
//                  leaves the rest of the file — comments included — alone.

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    return NextResponse.json({ defaults: accountDefaultsFor(defaultsOf(readAgentsMdKeys(accountDir(tenant))), actor.workspaces) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenant, actor } = await requireAccountWide(req, "workspace:manage");
    const body = (await req.json()) as Record<string, unknown>;
    // telemetry: sends every workspace's runs, with header secrets filled
    // from the vault, to the URL it names: only a caller who holds every
    // workspace may point it anywhere (Codex review).
    if ("telemetry" in body && actor.workspaces !== null) {
      return refuse("the account's telemetry needs access to every workspace — set telemetry: in a workspace's own AGENTS.md instead", 403);
    }
    const patch = defaultsPatch(body, readAgentsMdKeys(accountDir(tenant)));
    if ("error" in patch) return refuse(patch.error, 400);
    setAgentsMdKeys(accountDir(tenant), patch.keys);
    return NextResponse.json({ ok: true, defaults: defaultsOf(readAgentsMdKeys(accountDir(tenant))) });
  } catch (err) {
    return errorResponse(err);
  }
}
