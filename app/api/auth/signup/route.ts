// Create the account and sign its owner in, one POST. The first user on an
// install signs up freely (there is no one to ask: the bootstrap door); after
// that a stranger needs the free door open — signup.open,
// FOLDRUN_OPEN_SIGNUP=1. Paid sign-up (a plan chosen here, then checkout) is
// not built yet (Part B, FOL-125): a body naming a plan is refused rather
// than quietly given a free account.

import { opsLog } from "@/lib/ops-log.ts";
import { sendVerifyEmail } from "@/server/email";
import { billing } from "@/platform/billing";
import { platform } from "@/lib/platform";
import { verifyLink, publicOrigin } from "@/server/auth-flows";
import { errorResponse, refuse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/server/limits";
import { acceptInvite, createUser, hasUsers, mintSession, sessionCookieOptions, SESSION_COOKIE, setupTokenRequired, setupTokenMatches } from "@/server/users";
import { signupModesNow } from "@/server/signup";
import { refuseNonText } from "@/server/auth-input";
import { assertSignupAllowed, trialEligible } from "@/platform/signup";
import { audit } from "@/server/audit";
import { listWorkspaces, saveWorkspace, templateFiles } from "@/lib/store";
import { rateLimit } from "@/platform/cache";

// Signup had no limit at all, so the form could be asked about an unlimited
// number of addresses as fast as the box would answer. Login has had these
// two for a while and they answer the same two attacks: per-address stops
// someone hammering one account, per-IP stops one client working through a
// list — which the per-address limit never sees. Both are far above anything
// a person retrying a password meets.
const PER_EMAIL = { limit: 5, windowSec: 15 * 60 };
const PER_IP = { limit: 20, windowSec: 15 * 60 };


function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "too many attempts — wait a few minutes and try again" },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      account?: string;
      invite?: string;
      /** The install's setup token, for its first account (FOLDRUN_SETUP_TOKEN). */
      setup?: string;
      /** Not taken yet: paid sign-up's plan choice (Part B). */
      plan?: unknown;
    };
    // A plan is the paid door, which no route opens yet. Refused whatever it
    // holds (null included) and before anything else, so a request meant for
    // paid sign-up is never turned into a free account by accident.
    if (body && typeof body === "object" && "plan" in body) {
      return refuse("choosing a plan at sign-up is not available yet — sign up without one", 400);
    }
    const notText = refuseNonText(body, "email", "password", "account", "invite", "setup");
    if (notText) return notText;
    // Limited before anything is created, and before scrypt runs: hashing a
    // password is deliberately expensive, so an unlimited signup endpoint is
    // also an unlimited way to spend the box's CPU.
    const ip = clientIp(req);
    if (ip) {
      const byIp = await rateLimit(`signup:ip:${ip}`, PER_IP.limit, PER_IP.windowSec);
      if (!byIp.allowed) return tooMany(byIp.retryAfter);
    }
    const byEmail = await rateLimit(
      `signup:email:${(body.email ?? "").toLowerCase().trim()}`,
      PER_EMAIL.limit,
      PER_EMAIL.windowSec,
    );
    if (!byEmail.allowed) return tooMany(byEmail.retryAfter);

    // An invite decides the account and bypasses the open-signup gate — a
    // member chose to let this person in. The invite's row is the proof and
    // says what they get; whatever `account` the body claims is ignored. It
    // is used up in the same transaction that creates the member, so a link
    // lets in one person, once (acceptInvite, server/users.ts).
    const invited = typeof body.invite === "string" && body.invite !== "";
    // The first account of an install that set a setup token: only with it.
    // Checked before anything about the address, like the open-signup gate.
    const setupOk = setupTokenMatches(body.setup);
    if (!invited && (await setupTokenRequired()) && !setupOk) {
      return refuse("this install's first account needs its setup link — open the one the installer printed (…/signup?setup=…), or read FOLDRUN_SETUP_TOKEN in the install's .env", 403);
    }
    // A closed install refuses a stranger here, before the password's breach
    // lookup and scrypt: those ran first and the lock refused after, so with
    // no caller address to limit on, every new address bought both on an
    // install that would never take one (30 Oct 2026). The same sentence as
    // the lock's (core signup.ts, asked with nothing about the address), and
    // the lock still asks again for the race with the first sign-up.
    // Asked of the door this request asks for (free: there is no other yet)
    // with nothing about the address — the lock asks again, with it.
    if (!invited) {
      assertSignupAllowed({ joining: false, request: "free", modes: signupModesNow(await hasUsers()), accountExists: false, emailTaken: false, nameTaken: false });
    }
    const joined = invited ? await acceptInvite(body.invite!, body.email ?? "", body.password ?? "") : null;
    const user = joined ? joined.user : await createUser(body.email ?? "", body.password ?? "", body.account ?? "", { request: "free", setupToken: setupOk });
    // The first line of an account's log, or the line where a person joined it.
    await audit(joined ? "member.joined" : "account.created", {
      actor: user.email,
      tenant: user.tenant,
      subject: user.id,
      detail: joined ? { role: joined.invite.role, workspaces: joined.invite.workspaces, inviteId: joined.invite.id, invitedBy: joined.invite.createdByEmail } : { admission: user.admission ?? null },
    });
    // Prove the inbox, best effort: a sign-up that cannot get mail out is
    // still a sign-up; the dashboard will offer to resend until it lands.
    // Only the owner of a NEW account gets the trial on confirming, so only
    // they are told about it — see the grant in api/auth/verify.
    const trialCredits = !joined && platform.edition() === "hosted" && trialEligible(user.admission) ? billing().trialCredits() : undefined;
    void sendVerifyEmail(user.tenant, user.email, verifyLink(publicOrigin(req), user), { trialCredits }).then((r) => {
      if (!r.ok) opsLog("warn", "auth.verification_mail_not_sent");
    });

    // A brand-new account gets a working workspace so the first thing its
    // owner sees is the product, not an empty list with a create button.
    // Joiners land in whatever their team already has.
    let workspace: string | null = listWorkspaces(user.tenant)[0]?.name ?? null;
    if (!workspace) {
      saveWorkspace(user.tenant, "home", templateFiles("home"));
      workspace = "home";
    }

    const session = await mintSession(user, req.headers.get('user-agent'));
    const res = NextResponse.json({ ok: true, tenant: user.tenant, workspace });
    res.cookies.set(SESSION_COOKIE, session.value, sessionCookieOptions(req, session.expires));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
