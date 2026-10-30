// The sign-in routes read their body as `{ email?: string, … }` and call
// `.toLowerCase()` and `.trim()` on what came. A body with `"email": 1` or
// `"firstName": {}` threw a TypeError there, which answered 500 "something
// went wrong on our side" for what is the caller's mistake (30 Oct 2026).
// One check, in front of the reads: a named field that is present must be
// text. Absent and null stay what each route already makes of them.

import { NextResponse } from "next/server";

/** A 400 naming the first field that is present but not a string; else null. */
export function refuseNonText(body: unknown, ...names: string[]): NextResponse | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  for (const name of names) {
    const v = b[name];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${name} must be text` }, { status: 400 });
    }
  }
  return null;
}
