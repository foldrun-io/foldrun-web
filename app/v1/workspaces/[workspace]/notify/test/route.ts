// Prove the notification path works, while someone is watching.
//
// Sends one message to whatever this workspace's `notify:` resolves to and
// answers with what happened, including the provider's own words when it
// failed. Those words are the whole value: "domain not verified" and "you
// can only send to your own address" each send someone to a different page,
// and a bare status code sends them to the wrong one.
//
// It sends real mail to a real address, so it needs the permission that
// writes rather than the one that reads.

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { errorResponse, requirePermission, refuse } from "@/server/api";
import { sendTestNotification } from "@/lib/notify";
import { workspaceDir } from "@/lib/store";
import { idempotent } from "@/server/idempotency";
import { refuseWhenLimited } from "@/server/limits";

/** Test sends per workspace per hour (30 Oct 2026). Each one is real mail
 *  from the platform's domain, or a POST, to an address an editor chose; a
 *  loop with fresh Idempotency-Keys was bounded only by the API's general
 *  write limit. Enough to fix a setting and try again, several times. */
const TESTS_PER_HOUR = 10;

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const { tenant } = await requirePermission(req, "run:start");
    if (!fs.existsSync(workspaceDir(tenant, workspace))) {
      return refuse(`no workspace "${workspace}"`, 404);
    }
    const limited = await refuseWhenLimited(`notify-test:${tenant}:${workspace}`, TESTS_PER_HOUR, 3600);
    if (limited) return limited;
    const result = await sendTestNotification(tenant, workspace);
    // 200 either way: the request was handled and the answer is the result.
    // A 500 here would read as "the test endpoint is broken" rather than
    // "your notifications do not work", which is the opposite of the point.
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
