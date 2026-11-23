// Gates waiting on a person, across every workspace the caller can see.
//
// This exists for the dashboard's global banner: an email notification can be
// missed or filtered, and the per-workspace runs page only tells you about a
// gate you already navigated to. A parked run is money spent and a flow
// stopped — the one state that needs to find the person, not wait to be found.
//
// One entry per GATE, not per run. Two things that used to go wrong:
//
//   · It listed runs by run status. A decided gate flips its step to
//     `pending` at once, but the run stays `awaiting-approval` until the
//     worker resumes it — seconds, or minutes when the worker is busy — so
//     the banner cleared on the click and came straight back on the next
//     poll, until a full refresh happened to land after the resume.
//   · A run with two `!` steps in one group showed as one line naming the
//     first agent, and there was nothing to say what either was asking.
//
// Now the unit is the step that is actually waiting, with its question.

import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireCaller } from "@/server/api";
import { pendingForPeople, type PendingGate, type PendingQuestion } from "@/server/pending";

export const dynamic = "force-dynamic";

export type { PendingGate, PendingQuestion };

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    return NextResponse.json(await pendingForPeople(tenant, actor.workspaces));
  } catch (err) {
    return errorResponse(err);
  }
}
