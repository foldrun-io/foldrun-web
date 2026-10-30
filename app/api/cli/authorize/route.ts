// `foldrun login`, step two: the person, signed in, confirms the code.
//
//   GET  ?code=       what the page shows before deciding
//   POST { code, decision }   approve mints a key at this person's role; deny ends it
//
// A session, never a key: a key authorising another key would let a leaked
// CI key mint itself successors. Every role may sign its own CLI in — this
// is not managing keys, it is being yourself on another machine.

import { NextRequest, NextResponse } from "next/server";
import { roleOfUser, allowedWorkspaces } from "@/server/users";
import { describeCliLogin, decideCliLogin } from "@/server/cli-login";
import { errorResponse, sessionUser } from "@/server/api";

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code") ?? "";
    const row = await describeCliLogin(code);
    if (!row) return NextResponse.json({ error: "no such sign-in request — it may have expired; run `foldrun login` again" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await sessionUser(req);
    if (user instanceof Response) return user;
    if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });
    const body = (await req.json()) as { code?: string; decision?: string };
    if (!body.code) return NextResponse.json({ error: "expected { code }" }, { status: 400 });
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
    if (outcome === "not-found") {
      return NextResponse.json({ error: "no such sign-in request — it may have expired or already been decided" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status: outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
