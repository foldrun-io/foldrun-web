// A key is never more than the person who minted it.
//
// A key carries a role and a set of workspaces, like a member. Whoever
// mints one is choosing what to hand to a machine, and the rule is the
// same as for an invite: nobody hands out more than they hold. An admin
// scoped to two workspaces mints keys for those two at admin or below;
// an editor mints editor or viewer keys. Checked at the route, once,
// before createApiKey writes anything.

import { outranks, type Role } from "@/platform/permissions";
import { scopeAllows } from "@/platform/scope";

export interface KeyGrant {
  role: Role;
  /** null: every workspace. */
  workspaces: string[] | null;
}

/** An error the route maps straight to its status (see errorResponse). */
class KeyScopeError extends Error {
  status = 403;
}

/**
 * Refuse a key that would outrank or outreach its minter. Returns the
 * grant to write: what was asked for, or — when the minter is scoped and
 * did not say — the minter's own scope, since "all" is not theirs to give.
 */
export function withinMinter(minter: KeyGrant, asked: { role: Role; workspaces?: string[] | null }): KeyGrant {
  if (outranks(asked.role, minter.role)) {
    throw new KeyScopeError(`a key cannot outrank the person minting it — you are ${minter.role}, so it can be ${minter.role} or below`);
  }
  let workspaces: string[] | null = asked.workspaces === undefined ? null : asked.workspaces;
  if (minter.workspaces !== null) {
    if (asked.workspaces === undefined) workspaces = [...minter.workspaces];
    else if (workspaces === null) {
      throw new KeyScopeError("you are scoped to some workspaces, so a key must name which — it cannot open them all");
    } else {
      const beyond = workspaces.filter((w) => !scopeAllows(minter.workspaces, w));
      if (beyond.length) throw new KeyScopeError(`you cannot give a key a workspace you cannot open: ${beyond.join(", ")}`);
    }
  }
  return { role: asked.role, workspaces };
}

/**
 * Whether a key already minted is one this caller could have minted: the
 * same rule, read backwards. A scoped admin lists and revokes only keys
 * inside its own scope — never an unscoped key, such as the owner's. A key
 * minted before roles and scopes is an admin of every workspace.
 */
export function keyWithin(minter: KeyGrant, key: { role?: Role; workspaces?: string[] | null }): boolean {
  if (outranks(key.role ?? "admin", minter.role)) return false;
  if (minter.workspaces === null) return true;
  const workspaces = key.workspaces ?? null;
  return workspaces !== null && workspaces.every((w) => scopeAllows(minter.workspaces, w));
}
