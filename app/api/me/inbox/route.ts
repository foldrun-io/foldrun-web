// Your inbox (server/inbox.ts): what is waiting on you across your
// workspaces — gates, questions, issues, proposed fixes, your runs that went
// wrong — in three buckets: mine (assigned to you), started (runs you
// started), team (the rest that waits in your workspaces).
//
//   GET ?bucket=mine|started|team|all&kind=<kind>&workspace=<ws>&dismissed=1
//     → { person, items, counts }   (all but team by default; set-aside items only with dismissed=1)
//   POST { ids | id, action: read | unread | dismiss | restore }
//     → { read, dismissed }  — your own view only: dismissing never decides
//       a gate or resolves an issue
//
// A person's, keyed by their email. A key acts for the person who minted it,
// inside the key's own workspace scope; a key no person minted has no inbox.

import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requireCaller, sessionUser } from "@/server/api";
import { inboxFor, markInbox, personOf, type InboxAction, type InboxKind } from "@/server/inbox";

export const dynamic = "force-dynamic";

const BUCKETS = ["mine", "started", "team", "all"] as const;
const KINDS: InboxKind[] = ["approval", "question", "issue", "proposal", "run"];
const ACTIONS: InboxAction[] = ["read", "unread", "dismiss", "restore"];

async function who(req: NextRequest) {
  const { tenant, actor } = await requireCaller(req);
  // A support view reads as the owner; its actor is `support:<email>`, not a
  // person with an inbox, so the session's own address answers.
  const session = actor.readOnly ? await sessionUser(req) : null;
  const person = session && !(session instanceof NextResponse) ? session.email.toLowerCase() : actor.readOnly ? null : personOf(actor);
  if (!person) throw new ApiError("this key was not minted by a person, so it has no inbox — sign in, or use a key you made yourself", 400);
  return { tenant, actor, person };
}

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor, person } = await who(req);
    const q = req.nextUrl.searchParams;
    const bucket = q.get("bucket");
    const kind = q.get("kind");
    const workspace = q.get("workspace");
    if (bucket && !(BUCKETS as readonly string[]).includes(bucket)) throw new ApiError(`bucket is one of ${BUCKETS.join(", ")}`, 400);
    if (kind && !KINDS.includes(kind as InboxKind)) throw new ApiError(`kind is one of ${KINDS.join(", ")}`, 400);
    const view = await inboxFor(tenant, person, actor.workspaces, { role: actor.role });
    const wantDismissed = q.get("dismissed") === "1";
    const items = view.items.filter(
      (i) =>
        (wantDismissed ? i.dismissed : !i.dismissed) &&
        (bucket === "all" ? true : bucket ? i.bucket === bucket : i.bucket !== "team") &&
        (!kind || i.kind === kind) &&
        (!workspace || i.workspace === workspace),
    );
    return NextResponse.json({ person: view.person, items, counts: view.counts });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenant, person } = await who(req);
    const body = (await req.json().catch(() => ({}))) as { id?: unknown; ids?: unknown; action?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids : typeof body.id === "string" ? [body.id] : [];
    if (!ids.length || ids.some((i) => typeof i !== "string") || ids.length > 200) throw new ApiError("expected { id } or { ids: [...] } (at most 200)", 400);
    if (!ACTIONS.includes(body.action as InboxAction)) throw new ApiError(`action is one of ${ACTIONS.join(", ")}`, 400);
    const state = await markInbox(tenant, person, ids as string[], body.action as InboxAction);
    return NextResponse.json({ ok: true, read: state.read.length, dismissed: state.dismissed.length });
  } catch (err) {
    return errorResponse(err);
  }
}
