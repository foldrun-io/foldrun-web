// Who is calling — for `foldrun whoami`, and for anything that holds a
// credential and wants to know what it is. A person answers with their
// email; a key with its label and who minted it. Both say the account and
// the role, because those are what decide what happens next.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { listApiKeys } from "@/server/auth";
import { ownerOf } from "@/server/users";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const key = actor.kind === "key" ? (await listApiKeys(tenant)).find((k) => k.id === actor.id) ?? null : null;
    return NextResponse.json({
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
            },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
