// Which part of the product this process serves, and what an operator
// console would ask of the routes it shares with the customer app.
//
// foldrun's operator console is its own container with private code
// (foldrun-admin, 28 Oct 2026); the public edition has none. As this
// repository has it, this file says so everywhere: the one surface is the
// customer app, no request belongs to a console, no sign-in is refused for
// one, and a session is the customer app's. The hosted build replaces it
// (foldrun-admin overlay.sh).

import type { NextRequest, NextResponse } from "next/server";
import type { UserRecord } from "./users.ts";

export type Surface = "app";

export function surface(): Surface {
  return "app";
}

/** A console host's routing, ahead of the customer app's (proxy.ts): none. */
export async function consoleRoute(
  _req: NextRequest,
  _reply: { pass: () => NextResponse; answer: (res: NextResponse) => NextResponse },
): Promise<NextResponse | null> {
  return null;
}

/** A console's rule for a write (server/csrf.ts): undefined, the customer
 *  app's rules apply. */
export function consoleWrite(_req: { method: string; headers: Headers }): string | null | undefined {
  return undefined;
}

/** Why this person may not sign in here: nobody is refused for a console. */
export async function signInRefusal(_user: UserRecord): Promise<string | null> {
  return null;
}

/** The audience a session minted here carries: the customer app's. */
export function sessionAudience(): string | null {
  return null;
}
