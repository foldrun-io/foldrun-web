// The verification link lands here. The token names the user and the
// address it was sent to; if they still match, the address is verified and
// the person is sent to the dashboard. No session is minted — verifying an
// address is not signing in.

import { NextRequest, NextResponse } from "next/server";
import { readToken, hashFingerprint } from "@/server/auth-tokens";
import { findUserById, setEmailVerified, changeEmail, sessionIdOf, SESSION_COOKIE, type UserRecord } from "@/server/users";
import { revokeSessions } from "@/server/sessions";
import { sendEmailChangedNotice } from "@/server/email";
import { audit } from "@/server/audit";
import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { isOwner } from "@/server/users";
import { publicOrigin } from "@/server/auth-flows";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const move = readToken("email-change", token);
  if (move) return moveLogin(req, move);
  const claims = readToken("verify", token);
  const user = claims ? await findUserById(claims.u) : null;
  if (!user || user.email !== claims!.e) {
    return NextResponse.redirect(new URL("/login?verify=invalid", publicOrigin(req)));
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
  const invalid = () => NextResponse.redirect(new URL("/login?verify=invalid", publicOrigin(req)));
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
    if (!r.ok) console.warn("[email-change] notice to the old address not sent:", r.error);
  });
  return verified(req, { ...user, email: moved.to });
}

async function verified(req: NextRequest, user: UserRecord) {
  await setEmailVerified(user.id);
  await audit("email.verified", { actor: user.email, tenant: user.tenant });
  // The trial lands on a VERIFIED owner, once per account, and not a
  // moment before: credits handed out at signup are credits a script can
  // farm with throwaway addresses; a working inbox is the cheapest proof
  // of a person we have. Joiners bring nothing — their team has a wallet.
  if (platform.edition() === "hosted" && (await isOwner(user.tenant, user.id))) await billing().grantTrial(user.tenant);
  return NextResponse.redirect(new URL("/dashboard?verified=1", publicOrigin(req)));
}
