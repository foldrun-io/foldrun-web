// A login whose address is not confirmed makes no credentials (FOL-317,
// owner, 25 Nov 2026: "they should be blocked, email confirmation is
// needed").
//
// Anyone can sign up with someone else's address. Until the address is
// confirmed, that login is provisional: it can sign in and look around, but
// it cannot mint what outlives a password reset — API keys (and the keys
// `foldrun login` mints), a second factor, MCP OAuth grants and machine
// clients, or team invites. When the real owner of the inbox later resets the
// password, there is nothing left behind for the first signer.
//
// Whether confirmation is required is the install's policy, never an
// account's (Codex, FOL-317): the hosted platform always requires it, even
// while its sender is down; any install with its own sender requires it; a
// self-hosted install may require it with FOLDRUN_REQUIRE_EMAIL_CONFIRMATION=1.
// A self-hosted install with no sender of its own can never confirm anyone,
// so there nothing is held back. An account's own mail secret toggles nothing.

import { platform } from "@/lib/platform";

export const EMAIL_UNCONFIRMED = "email_unconfirmed";

/** The refusal, the same words everywhere it can come from. */
export function unconfirmedError(): Error & { status: number; code: string } {
  return Object.assign(
    new Error("confirm your email address first: open the link we mailed you when you signed up (Profile can send it again). Until then this login cannot create keys, two-step sign-in, connected apps or invites"),
    { status: 403, code: EMAIL_UNCONFIRMED },
  );
}

/** Must this person confirm their address before making a credential? */
export function mustConfirm(person: { tenant: string; emailVerifiedAt?: string | Date | null }): boolean {
  return !person.emailVerifiedAt && confirmationRequired();
}

/** The install's policy: is an unconfirmed address held back here? */
export function confirmationRequired(): boolean {
  return platform.edition() === "hosted" || Boolean(process.env.FOLDRUN_RESEND_API_KEY?.trim()) || process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION === "1";
}

/** The person behind an actor, when there is one, refused when unconfirmed:
 *  a signed-in person by id; a key by the person it was minted for. */
export async function assertActorConfirmed(tenant: string, actor: { kind: string; id: string; name: string }): Promise<void> {
  const { findUser, findUserById } = await import("./users.ts");
  const person = actor.kind === "user" ? await findUserById(actor.id) : actor.name.includes("@") ? await findUser(actor.name) : null;
  if (person && person.tenant === tenant) assertConfirmed(person);
}

/** Refuse, with a 403 the routes pass on, when the person must confirm first. */
export function assertConfirmed(person: { tenant: string; emailVerifiedAt?: string | Date | null }): void {
  if (mustConfirm(person)) throw unconfirmedError();
}
