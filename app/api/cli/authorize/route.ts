// `foldrun login`, step two: the person, signed in, confirms the code.
//
//   GET  ?code=       what the page shows before deciding: the machine, when
//                     and from where it asked (when known), whether that is
//                     the network this browser is on, and until when it can
//                     be approved
//   POST { code, decision }   approve mints a key at this person's role; deny ends it
//
// Device-code phishing (RFC 8628 §5.4): someone runs `foldrun login`, sends
// a person the link and waits for them to approve it. So the page shows
// where the request came from beside a plain warning, and a request older
// than five minutes cannot be approved (410) — long enough to confirm one's
// own terminal, short for a code carried to someone else (30 Oct 2026).
//
// A session, never a key: a key authorising another key would let a leaked
// CI key mint itself successors. Every role may sign its own CLI in — this
// is not managing keys, it is being yourself on another machine.

import { NextRequest, NextResponse } from "next/server";
import { roleOfUser, allowedWorkspaces } from "@/server/users";
import { describeCliLogin, decideCliLogin, requestOrigin } from "@/server/cli-login";
import { errorResponse, sessionUser } from "@/server/api";
import { jsonObject } from "@/server/body";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code") ?? "";
    const row = await describeCliLogin(code);
    if (!row) return NextResponse.json({ error: "no such sign-in request — it may have expired; run `foldrun login` again" }, { status: 404 });
    // Whether the browser looking is on the network that asked: null when
    // either side is not known.
    const here = requestOrigin(req).network;
    return NextResponse.json({ ...row, sameNetwork: here && row.requestedFrom ? here === row.requestedFrom : null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await sessionUser(req);
    if (user instanceof Response) return user;
    if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    // A JSON object with a string code, or 400: a `null` body, or a code
    // that is not a string, used to reach the lookup and answer 500.
    const body = await jsonObject(req);
    if (typeof body.code !== "string" || !body.code) return NextResponse.json({ error: "expected { code }" }, { status: 400 });
    // Absent means approve, as it always has (the sign-in page and the
    // CLI's own end-to-end test send none). A word is one of exactly two:
    // anything else used to approve too, so a typo ("reject") minted a key.
    const decision = body.decision === undefined ? "approve" : body.decision;
    if (decision !== "approve" && decision !== "deny") {
      return NextResponse.json({ error: "expected { decision: \"approve\" | \"deny\" } (or none, to approve)" }, { status: 400 });
    }
    const role = (await roleOfUser(user.tenant, user.id)) ?? "viewer";
    const workspaces = await allowedWorkspaces(user.tenant, user.id);
    const outcome = await decideCliLogin(body.code, decision, { tenant: user.tenant, email: user.email, role, workspaces });
    if (outcome === "too-old") {
      return NextResponse.json({ error: "this sign-in request is more than five minutes old, so it can no longer be approved — approve only a code you started yourself just now; run `foldrun login` again" }, { status: 410 });
    }
    if (outcome === "not-found") {
      return NextResponse.json({ error: "no such sign-in request — it may have expired or already been decided" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status: outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
