// Confirming an address, and moving a login to a new one. The token names
// the user and the address it was sent to; if they still match, the address
// is verified and the person is sent to the dashboard. No session is minted —
// verifying an address is not signing in.
//
// Only a POST changes anything (FOL-319). Mail scanners and link previewers
// open every link in a message; a GET that confirmed handed a working login
// to whoever had signed up with someone else's address, the moment the real
// inbox's scanner looked. The mailed link opens the /verify page, which shows
// the address and posts the token when the person presses Confirm. A GET here
// (links mailed before) only sends the browser to that page.

import { opsLog } from "@/lib/ops-log.ts";
import { NextRequest, NextResponse } from "next/server";
import { readToken, hashFingerprint } from "@/server/auth-tokens";
import { findUserById, setEmailVerified, changeEmail, sessionIdOf, SESSION_COOKIE, type UserRecord } from "@/server/users";
import { revokeSessions } from "@/server/sessions";
import { sendEmailChangedNotice } from "@/server/email";
import { audit } from "@/server/audit";
import { grantTrialIfEarned } from "@/server/trial";
import { publicOrigin } from "@/server/auth-flows";

/** A link mailed before FOL-319: to the page that asks, never a change. */
export async function GET(req: NextRequest) {
  const to = new URL("/verify", publicOrigin(req));
  to.searchParams.set("token", req.nextUrl.searchParams.get("token") ?? "");
  return NextResponse.redirect(to, 303);
}

/** The /verify page's Confirm button (a form post), or a program sending { token } as JSON. */
export async function POST(req: NextRequest) {
  const type = req.headers.get("content-type") ?? "";
  let token = "";
  if (type.includes("application/x-www-form-urlencoded")) token = new URLSearchParams(await req.text()).get("token") ?? "";
  else if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    token = body && typeof body === "object" && typeof body.token === "string" ? body.token : "";
  }
  const move = readToken("email-change", token);
  if (move) return moveLogin(req, move);
  const claims = readToken("verify", token);
  const user = claims ? await findUserById(claims.u) : null;
  if (!user || user.email !== claims!.e) {
    return NextResponse.redirect(new URL("/login?verify=invalid", publicOrigin(req)), 303);
  }
  return verified(req, user);
}

/**
 * The link an email change mailed to the new address (emailChangeLink,
 * 30 Oct 2026): clicking it is the move. Only while the login has moved no
 * times since it was asked for (so it works once, A → B → A included), is
 * still at that address, and has the password it was asked with (a change
 * or reset since cancels it). Clicking from
 * that inbox proves it, so the new address is verified at once. Every other
 * session ends — the one in this browser stays if it is this person's —
 * and the old address is told.
 */
async function moveLogin(req: NextRequest, claims: Record<string, string>) {
  const invalid = () => NextResponse.redirect(new URL("/login?verify=invalid", publicOrigin(req)), 303);
  const user = await findUserById(claims.u);
  if (!user || user.email !== claims.e || hashFingerprint(user.hash) !== claims.h || !claims.to || !/^\d+$/.test(claims.n ?? "")) return invalid();
  let moved: { from: string; to: string };
  try {
    // The move count is checked and bumped inside the write: this link
    // spends itself, and a link from before any later move is dead.
    moved = await changeEmail(user.id, claims.to, { ifMoves: Number(claims.n) });
  } catch {
    return invalid(); // used, superseded by a later move, or taken since
  }
  const ended = await revokeSessions(user.id, sessionIdOf(req.cookies.get(SESSION_COOKIE)?.value) ?? undefined);
  await audit("email.changed", { actor: moved.from, tenant: user.tenant, subject: user.id, detail: { from: moved.from, to: moved.to, otherSessionsEnded: ended } });
  void sendEmailChangedNotice(user.tenant, moved.from, moved.to).then((r) => {
    if (!r.ok) opsLog("warn", "auth.email_change_notice_not_sent");
  });
  return verified(req, { ...user, email: moved.to });
}

async function verified(req: NextRequest, user: UserRecord) {
  await setEmailVerified(user.id);
  await audit("email.verified", { actor: user.email, tenant: user.tenant });
  // The trial lands now, not before (server/trial.ts).
  await grantTrialIfEarned(user);
  return NextResponse.redirect(new URL("/dashboard?verified=1", publicOrigin(req)), 303);
}
