// Create the account and sign its owner in, one POST. The first user on an
// install signs up freely (there is no one to ask); after that the install
// must opt in to strangers with FOLDRUN_OPEN_SIGNUP=1.

import { sendVerifyEmail } from "@/server/email";
import { billing } from "@/platform/billing";
import { platform } from "@/lib/platform";
import { verifyLink, publicOrigin } from "@/server/auth-flows";
import { errorResponse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/server/limits";
import { createUser, mintSession, verifyInvite, sessionCookieOptions, SESSION_COOKIE } from "@/server/users";
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
    };
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
    // member chose to let this person in. The token itself is the proof;
    // whatever `account` the body claims is ignored.
    const invited = body.invite ? verifyInvite(body.invite) : null;
    if (body.invite && !invited) {
      return NextResponse.json({ error: "that invite is invalid or expired" }, { status: 400 });
    }
    if (invited?.email && (body.email ?? "").trim().toLowerCase() !== invited.email) {
      return NextResponse.json({ error: `this invite was sent to ${invited.email} — sign up with that address` }, { status: 400 });
    }
    const user = invited
      ? await createUser(body.email ?? "", body.password ?? "", invited.tenant, { joining: true, role: invited.role, workspaces: invited.workspaces })
      : await createUser(body.email ?? "", body.password ?? "", body.account ?? "");
    // The first line of an account's log, or the line where a person joined it.
    await audit(invited ? "member.joined" : "account.created", { actor: user.email, tenant: user.tenant, subject: user.id, detail: invited ? { role: invited.role } : {} });
    // Prove the inbox, best effort: a sign-up that cannot get mail out is
    // still a sign-up; the dashboard will offer to resend until it lands.
    // Only the owner of a NEW account gets the trial on confirming, so only
    // they are told about it — see the grant in api/auth/verify.
    const trialCredits = !invited && platform.edition() === "hosted" ? billing().trialCredits() : undefined;
    void sendVerifyEmail(user.tenant, user.email, verifyLink(publicOrigin(req), user), { trialCredits }).then((r) => {
      if (!r.ok) console.warn("[signup] verification mail not sent:", r.error);
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
