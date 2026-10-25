// The theme for this request: the signed-in person's choice, else "system".
// Cached per render so the root layout and any page asking again share one
// session lookup.

import { cache } from "react";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { themePreference, type Theme } from "@/components/theme-model";

export const requestTheme = cache(async (): Promise<Theme> => {
  try {
    const person = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    return themePreference(person?.prefs);
  } catch {
    // A theme is never worth an error page.
    return "system";
  }
});
