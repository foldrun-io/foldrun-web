import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, requireAccountWide } from "@/server/api";
import { accountDir } from "@/lib/store";
import { readAgentsMdKeys, setAgentsMdKeys } from "@/lib/agents-md";
import { defaultsPatch, defaultsOf } from "@/components/defaults-model";

// The account's defaults — what its AGENTS.md frontmatter sets for every
// workspace: a timezone for schedules, where to notify, a monthly cap.
//
//   GET            the current values
//   PATCH { … }    set some; null clears one. Edits the keys in place and
//                  leaves the rest of the file — comments included — alone.

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant(req);
    return NextResponse.json({ defaults: defaultsOf(readAgentsMdKeys(accountDir(tenant))) });
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
      return NextResponse.json({ error: "the account's telemetry needs access to every workspace — set telemetry: in a workspace's own AGENTS.md instead" }, { status: 403 });
    }
    const patch = defaultsPatch(body, readAgentsMdKeys(accountDir(tenant)));
    if ("error" in patch) return NextResponse.json({ error: patch.error }, { status: 400 });
    setAgentsMdKeys(accountDir(tenant), patch.keys);
    return NextResponse.json({ ok: true, defaults: defaultsOf(readAgentsMdKeys(accountDir(tenant))) });
  } catch (err) {
    return errorResponse(err);
  }
}
