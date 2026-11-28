// Who may act on one pending invite of their account, and who may answer
// one sent to them (FOL-464). Both are a person: a dashboard session, or
// their own `foldrun login` key.

import type { NextRequest } from "next/server";
import { ApiError, requirePerson, sessionUser } from "./api";
import type { Actor, PersonCredential } from "./auth";
import { reachInvite } from "./users";

/** The credential a person's request came with, for the check under the lock. */
const credentialOf = (actor: Actor): PersonCredential | undefined => actor.credential ?? (actor.via ? { key: actor.via.cliLoginKey } : undefined);

/** A browser request must come with a dashboard sign-in: a support view
 *  writes nothing, and a session made for another audience (the operator
 *  console's) is no dashboard sign-in. A person's own CLI key passes. */
export async function assertDashboardSession(req: NextRequest, actor: Actor): Promise<void> {
  if (actor.readOnly) throw new ApiError("a support view does not do this", 403);
  if (actor.via) return;
  const me = await sessionUser(req);
  if (!me || me instanceof Response || me.viewAs || !me.session || me.session.audience) throw new ApiError("sign in to the dashboard first", 401);
}

/** A pending invite of this account for the member who would send it again
 *  or copy its link (users.ts reachInvite: decided under the people lock). */
export async function reachableInvite(tenant: string, id: string, actor: Actor) {
  const credential = credentialOf(actor);
  return reachInvite(tenant, id, { id: actor.id, role: actor.role, workspaces: actor.workspaces, ...(credential ? { credential } : {}) });
}

/**
 * The person themself, for what is theirs alone (the invites sent to their
 * address): never a support view, which reads an account as its owner, not
 * the owner's own post; and never a session made for another audience (the
 * operator console's), which is no dashboard sign-in.
 */
export async function requireSelf(req: NextRequest): Promise<{ actor: Actor & { kind: "user" }; from: { tenant: string; credential?: PersonCredential } }> {
  const { tenant, actor } = await requirePerson(req, "workspace:read", { cliLogin: true });
  await assertDashboardSession(req, actor);
  const credential = credentialOf(actor);
  return { actor, from: { tenant, ...(credential ? { credential } : {}) } };
}
