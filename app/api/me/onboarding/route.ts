// Getting started — the account's first steps, each derived from what is
// really there (components/onboarding-model.ts), and whether this person has
// hidden the card.
//
//   GET                      { steps, done, total, complete, next, dismissed }
//   PATCH { dismissed: bool }  hide or bring back the card, for this person
//
// Read by anyone in the account, key or person. Hiding it is a person's
// own setting (users.prefs), so PATCH needs a signed-in person; a key reads
// `dismissed: false`, since a key is nobody.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requireSession, errorResponse, ApiError } from "@/server/api";
import { onboardingFor, ONBOARDING_PREF } from "@/server/onboarding";
import { findUserById, setUserPrefs, verifySession, SESSION_COOKIE } from "@/server/users";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireCaller(req);
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    const person = session ? await findUserById(session.id) : null;
    const dismissedAt = (person?.prefs?.[ONBOARDING_PREF] as string | undefined) ?? null;
    return NextResponse.json({ ...(await onboardingFor(tenant)), dismissed: Boolean(dismissedAt), dismissedAt });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const person = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as { dismissed?: unknown };
    if (typeof body.dismissed !== "boolean") throw new ApiError("expected { dismissed: true | false }", 400);
    const at = body.dismissed ? new Date().toISOString() : null;
    await setUserPrefs(person.id, { [ONBOARDING_PREF]: at });
    return NextResponse.json({ ok: true, dismissed: body.dismissed, dismissedAt: at });
  } catch (err) {
    return errorResponse(err);
  }
}
