// What mail you get: every category, whether it is on, and the workspaces
// where it differs. Yours alone — a person's choices, keyed by their email.
// A key acts for the person who minted it, so `foldrun notifications` works
// from a signed-in terminal.
//
//   GET    → { email, categories: [{ category, label, required, why?, perWorkspace, enabled, workspaces }] }
//   PATCH  { category, enabled, workspace? }   or   { preferences: [ … ] }
//
// A required category (security, invites, billing failures, account notices)
// cannot be turned off: 409, with the reason.

import { NextRequest, NextResponse } from "next/server";
import { ApiError, assertWorkspaceScope, errorResponse, requireCaller, sessionUser } from "@/server/api";
import { preferenceSummary, setPreference, PreferenceError } from "@/platform/email-preferences";

async function who(req: NextRequest) {
  const { tenant, actor } = await requireCaller(req);
  // A person is their login; a key is the person who minted it, which
  // auth.ts puts in the actor's name. A support view reads as the owner
  // (writes are already refused by the funnel): its actor name is
  // `support:<email>` for the audit trail, not an address anyone has, so
  // the person is the session's, as /api/me/preferences reads it.
  const session = actor.readOnly ? await sessionUser(req) : null;
  const email = session && !(session instanceof NextResponse) ? session.email : actor.name?.includes("@") && !actor.readOnly ? actor.name : null;
  if (!email) throw new ApiError("this key was not minted by a person — sign in, or use a key you made yourself", 400);
  return { tenant, actor, email };
}

export async function GET(req: NextRequest) {
  try {
    const { tenant, email } = await who(req);
    return NextResponse.json({ email, categories: await preferenceSummary(tenant, email) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenant, actor, email } = await who(req);
    const body = (await req.json().catch(() => null)) as
      | { category?: unknown; enabled?: unknown; workspace?: unknown; preferences?: unknown }
      | null;
    const changes = Array.isArray(body?.preferences) ? (body!.preferences as unknown[]) : body ? [body] : [];
    if (!changes.length) throw new ApiError("expected { category, enabled, workspace? } or { preferences: [ … ] }", 400);
    for (const c of changes) {
      const { category, enabled, workspace } = (c ?? {}) as { category?: unknown; enabled?: unknown; workspace?: unknown };
      if (typeof category !== "string" || typeof enabled !== "boolean") {
        throw new ApiError("each change is { category: string, enabled: boolean, workspace?: string }", 400);
      }
      if (workspace !== undefined && workspace !== null && typeof workspace !== "string") throw new ApiError("workspace is a name", 400);
      if (typeof workspace === "string" && workspace) assertWorkspaceScope(actor, workspace);
      try {
        await setPreference(tenant, email, category, enabled, { workspace: (workspace as string | null | undefined) ?? null, source: actor.kind === "user" ? "settings" : "api" });
      } catch (err) {
        if (err instanceof PreferenceError) throw new ApiError(err.message, err.status);
        throw err;
      }
    }
    return NextResponse.json({ email, categories: await preferenceSummary(tenant, email) });
  } catch (err) {
    return errorResponse(err);
  }
}
