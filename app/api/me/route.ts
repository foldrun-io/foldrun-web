// Who is calling — for `foldrun whoami`, and for anything that holds a
// credential and wants to know what it is. A person answers with their
// email; a key with its label and who minted it. Both say the account and
// the role, because those are what decide what happens next.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, cliLoginPerson } from "@/server/api";
import { listApiKeys } from "@/server/auth";
import { ownerOf, findUserById } from "@/server/users";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const key = actor.kind === "key" ? (await listApiKeys(tenant)).find((k) => k.id === actor.id) ?? null : null;
    // The person this credential is: a signed-in session, or the one behind
    // a `foldrun login` key — what `foldrun me` shows and changes. Null for
    // a key made by hand, an AI app's connection and support's view.
    const personId = actor.readOnly ? null : actor.kind === "user" ? actor.id : (await cliLoginPerson(tenant, actor))?.id ?? null;
    const user = personId ? await findUserById(personId) : null;
    return NextResponse.json({
      person: user ? { email: user.email, firstName: user.firstName ?? null, lastName: user.lastName ?? null, timezone: user.timezone ?? null } : null,
      account: tenant,
      owner: (await ownerOf(tenant))?.email ?? null,
      role: actor.role,
      workspaces: actor.workspaces, // null: all of them
      actor:
        actor.kind === "user"
          ? { kind: "user", email: actor.name }
          : {
              kind: "key",
              id: actor.id,
              label: key?.label ?? null,
              prefix: key?.prefix ?? null,
              createdBy: key?.createdBy ?? null,
              createdAt: key?.createdAt ?? null,
              // FOL-71: when it ends, and whether it renews itself — the CLI
              // reads both to rotate a `foldrun login` key before it ends.
              expiresAt: key?.expiresAt ?? null,
              origin: key?.origin ?? null,
            },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
