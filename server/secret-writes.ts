// The one gate every route that writes a vault secret on a caller's behalf
// passes before it writes: PUT/PATCH/DELETE /api/secrets, and the OAuth
// connect routes (start, reconnect, a hand-off's accept), whose callback
// stores the secret later with no caller left to ask. A rule added here holds
// for all of them; a rule kept in one route was walked around through the
// others (30 Oct 2026: the owner-only mail sender was set through an OAuth
// connect, and through PUT with a name sent as a list).

import { ApiError, assertWorkspaceScope } from "./api.ts";
import type { Actor } from "./auth.ts";
import { ownerOf } from "./users.ts";

/** The account's mail sender: core platformMail sends members' password-reset
 *  and sign-up links through it. */
export const MAIL_SENDER: ReadonlySet<string> = new Set(["RESEND_API_KEY", "EMAIL_FROM"]);

/**
 * The one rule for an act only the owner may do through a key-or-session
 * route: the owner as a PERSON — their own signed-in session, or the key
 * their own `foldrun login` minted (origin "cli-login", minted by whoever
 * owns the account now). Any other key the owner minted — a CI key, an admin
 * key handed to a contractor — is an account credential, not the owner, and
 * is refused (owner decision, 30 Oct 2026: every key used to count, because
 * a key's actor name is its minter's address).
 *
 * Role "owner" is only ever the owner's session or the local dev stand-in
 * (FOLDRUN_DEV_NO_AUTH): a key is never minted an owner. A support view
 * reads as the owner and acts for no one.
 */
export async function actsForOwner(tenant: string, actor: Pick<Actor, "role" | "kind" | "name" | "id"> & Pick<Partial<Actor>, "origin" | "readOnly">): Promise<boolean> {
  if (actor.readOnly) return false;
  if (actor.role === "owner") return actor.kind === "user" || actor.id === "dev";
  if (actor.kind !== "key" || actor.origin !== "cli-login") return false;
  const owner = await ownerOf(tenant);
  return Boolean(owner && actor.name.toLowerCase() === owner.email.toLowerCase());
}

/**
 * May this caller write the secret `name` at this scope (no workspace: the
 * account's store)? Returns the name, checked to be a string: a JSON body can
 * send a list, which a Set lookup does not match but core's name pattern and
 * the vault's keys coerce to the same text — `["RESEND_API_KEY"]` was stored
 * as RESEND_API_KEY past the check below.
 */
export async function assertMayWriteSecret(tenant: string, actor: Actor, name: unknown, workspace: unknown): Promise<string> {
  if (typeof name !== "string" || !name) throw new ApiError("a secret's name is a string, like API_KEY", 400);
  if (workspace !== undefined && workspace !== null && typeof workspace !== "string") {
    throw new ApiError("workspace is a workspace's name, as a string", 400);
  }
  const scope = workspace || undefined;
  assertWorkspaceScope(actor, scope);
  // Only the owner chooses the mail sender: an admin who pointed it at their
  // own Resend account could read the owner's reset link and take the account.
  if (!scope && MAIL_SENDER.has(name) && !(await actsForOwner(tenant, actor))) {
    throw new ApiError(`only the account's owner can set ${name} — it is the sender of everyone's sign-in mail`, 403);
  }
  return name;
}
