// Who is calling — for `foldrun whoami`, and for anything that holds a
// credential and wants to know what it is. A person answers with their
// email; a key with its label and who minted it. Both say the account and
// the role, because those are what decide what happens next.

import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse, cliLoginPerson } from "@/server/api";
import { listApiKeys } from "@/server/auth";
import { modelGrantOf } from "@/platform/api-keys-db";
import { gatewayUrl } from "@/server/gateway-keys";
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
              // One key (22 Nov 2026): whether this same key may call
              // foldrun's models, within which limits — null for a key that
              // opens the platform API alone. `foldrun code` reads it to use
              // the sign-in for its model calls instead of making a second key.
              modelAccess: key ? modelAccessView(key) : null,
            },
      // Where model calls go (the gateway's base, for ANTHROPIC_BASE_URL);
      // null where this install has none.
      modelsUrl: gatewayUrl(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function modelAccessView(key: Parameters<typeof modelGrantOf>[0]): { capUsd: number | null; dailyUsd: number | null; walletUsd: number } | null {
  const g = key.purpose === undefined ? modelGrantOf(key) : null;
  return g ? { capUsd: g.capUsd ?? null, dailyUsd: g.dailyUsd ?? null, walletUsd: g.walletUsd ?? 0 } : null;
}
