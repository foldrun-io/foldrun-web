// Change your own email address.
//
// The session says who you are; the body has to prove you know your
// password, for the same reason the password route does — a borrowed
// unlocked browser must not be able to re-point a login at a stranger's
// inbox.
//
// Asking does not move anything (30 Oct 2026). It mails the NEW address: a
// link that makes the move when it is free (emailChangeLink, landing on
// /api/auth/verify), or a note that it already has a login when it is
// taken — and answers the caller the same either way. It used to move at
// once and answer 409 "that address already belongs to someone", which let
// any signed-in person test every address on the install, closed-signup
// installs included, with the rate limit cleared on each right password.
// The move, the old address's notice and the end of every other session
// happen at the click.
//
// An install that can send no mail at all cannot prove a new inbox, so it
// refuses (409) and says how to set mail up (owner decision, 30 Oct 2026).
// It used to move the login at once, unverified — a borrowed session plus
// the password re-pointed resets at any inbox, and the move's 409 for a
// taken address was the enumeration oracle the mailed path closed.

import { errorResponse, sessionUser } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, findUser, findUserById, loginAddress } from "@/server/users";
import { refuseWhenLimited, clearLimit } from "@/server/limits";
import { refuseNonText } from "@/server/auth-input";
import { sendEmailChangeConfirm, sendEmailTakenNotice } from "@/server/email";
import { emailChangeLink, publicOrigin } from "@/server/auth-flows";
import { platformMail } from "@/lib/notify";
import { audit } from "@/server/audit";

// Six tries in fifteen minutes, like the password change: this route
// verifies a password too, and was the one place a stolen session could
// grind it for free. Cleared only when a request has gone all the way
// through, never on the password alone.
const LIMIT = { limit: 6, windowSec: 15 * 60 };

// Each request mails an address the caller typed, from the platform's
// sender, in the uncapped "security" category — so it is capped here, per
// person per day, the way invites are capped per account (29 Oct 2026). A
// person moving their login needs one or two; five covers typos.
const EMAIL_CHANGES_PER_DAY = 5;

/** The refusal on an install with no sender — what to do, not just "no". */
const NO_MAIL =
  "this install cannot send mail yet, so a new address cannot be confirmed and your login stays where it is — " +
  "the account's owner sets RESEND_API_KEY and EMAIL_FROM as account secrets (Settings → Secrets, or `foldrun secrets set`), " +
  "or whoever runs the install sets FOLDRUN_RESEND_API_KEY; then try again";

export async function POST(req: NextRequest) {
  const user = await sessionUser(req);
  if (user instanceof Response) return user;
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const limited = await refuseWhenLimited(`email:${user.id}`, LIMIT.limit, LIMIT.windowSec);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { password?: string; email?: string };
  const notText = refuseNonText(body, "password", "email");
  if (notText) return notText;
  try {
    if (!(await passwordMatches(user.id, body.password ?? ""))) {
      return NextResponse.json({ error: "that is not your password" }, { status: 400 });
    }
    const to = loginAddress(body.email ?? "");
    if (to === user.email) return NextResponse.json({ error: "that is already your address" }, { status: 409 });

    if (!platformMail(user.tenant)) {
      // No sender, so no inbox can be proven: nothing moves.
      return NextResponse.json({ error: NO_MAIL, code: "mail_not_configured" }, { status: 409 });
    }

    const daily = await refuseWhenLimited(`email-change:day:${user.id}`, EMAIL_CHANGES_PER_DAY, 24 * 60 * 60);
    if (daily) return daily;

    const fresh = await findUserById(user.id);
    if (!fresh) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    const taken = Boolean(await findUser(to));
    const sent = taken
      ? await sendEmailTakenNotice(user.tenant, to, user.email)
      : await sendEmailChangeConfirm(user.tenant, to, user.email, emailChangeLink(publicOrigin(req), fresh, to));
    if (sent.ok) await clearLimit(`email:${user.id}`);
    // Whether the address was taken is not recorded: this log is read back
    // by the account's admins, and it would be the same oracle.
    await audit("email.change_requested", { actor: user.email, tenant: user.tenant, subject: user.id, detail: { to, sent: sent.ok } });
    return NextResponse.json({ ok: true, from: user.email, to, pending: true, verificationSent: sent.ok, otherSessionsEnded: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
