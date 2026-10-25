// A person's own display preferences — today, the theme.
//
//   GET                                  { theme }
//   PATCH { theme: system | light | dark } → { theme }
//
// Kept in users.prefs, so it follows the person to every browser they sign
// in on. A key acts for the person who minted it, as /api/me/notifications
// does; a key minted by nobody has no preferences to read or set.

import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireCaller, sessionUser } from "@/server/api";
import { findUser, findUserById, setUserPrefs, type UserRecord } from "@/server/users";
import { isTheme, themePreference, THEME_PREF, THEMES } from "@/components/theme-model";
import { checkRunViews, runViewsOf, RUN_VIEWS_PREF } from "@/components/run-views-model";

export const dynamic = "force-dynamic";

/** The person: the session's, else the one who minted the key. A ready
 *  response when the session may not do this (support's read-only view). */
async function person(req: NextRequest): Promise<UserRecord | NextResponse> {
  const session = await sessionUser(req);
  if (session instanceof NextResponse) return session;
  if (session) return session;
  const { tenant, actor } = await requireCaller(req);
  const email = actor.name?.includes("@") ? actor.name : null;
  const user = email ? await findUser(email) : null;
  if (!user || user.tenant !== tenant) throw new ApiError("this key was not minted by a person — sign in, or use a key you made yourself", 400);
  return user;
}

export async function GET(req: NextRequest) {
  try {
    const user = await person(req);
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ theme: themePreference(user.prefs), runViews: runViewsOf(user.prefs) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await person(req);
    if (user instanceof NextResponse) return user;
    const body = (await req.json().catch(() => null)) as { theme?: unknown; runViews?: unknown } | null;
    if (!body || (!("theme" in body) && !("runViews" in body))) throw new ApiError(`expected { theme: ${THEMES.join(" | ")} } and/or { runViews: [{ name, query }] }`, 400);
    const patch: Record<string, unknown> = {};
    if ("theme" in body) {
      if (!isTheme(body.theme)) throw new ApiError(`theme is one of ${THEMES.join(", ")}`, 400);
      // "system" is the default, so it is stored as nothing at all.
      patch[THEME_PREF] = body.theme === "system" ? null : body.theme;
    }
    if ("runViews" in body) {
      // Saved run searches (FOL-72 step 9): the whole list, replaced.
      const checked = checkRunViews(body.runViews);
      if ("error" in checked) throw new ApiError(checked.error, 400);
      patch[RUN_VIEWS_PREF] = checked.views.length ? checked.views : null;
    }
    await setUserPrefs(user.id, patch);
    const prefs = (await findUserById(user.id))?.prefs;
    return NextResponse.json({ theme: themePreference(prefs), runViews: runViewsOf(prefs) });
  } catch (err) {
    return errorResponse(err);
  }
}
