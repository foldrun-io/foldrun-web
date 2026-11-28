// What a login made before anyone proved its inbox ends when the inbox's owner
// takes it back (FOL-317, Codex). A reset of an unconfirmed address calls this
// BEFORE the reset is written: a valid link already proves the inbox, and if
// this fails the link is not spent and the login is still unconfirmed, so the
// next try runs it again (done after, a crash between lost it for good). It ends every API key minted for the person (`foldrun login`, gateway and
// A2A keys included), every connected app (MCP OAuth grants and machine
// clients, with their tokens) and every pending invite they made. Its second
// factor is cleared in the reset's own write (users.ts redeemReset). Creating
// any of these needs a confirmed address since FOL-317 (email-confirmed.ts),
// so this only finds what was made before that, or by a key minted then.

import { listApiKeys, revokeApiKey } from "./auth.ts";
import { dropCodesOf, listGrants, revokeGrant } from "./mcp-oauth.ts";
import { revokeInvitesBeyond } from "./users.ts";
import { audit } from "./audit.ts";
import { hashFingerprint } from "./auth-tokens.ts";

// Only what was made before `before`: two resets at once, the losing one must
// not revoke what the inbox's owner made after the winning one (Codex). The
// route sweeps before the reset (cutoff: the request's start) and again right
// after it (cutoff: a time taken inside the reset's own transaction, before
// which the inbox's owner cannot have made anything), for an app exchange that
// landed between.
export async function revokeProvisional(person: { id: string; tenant: string; email: string; hash: string }, before: Date): Promise<{ keys: number; grants: number; invites: number }> {
  // In every account they are in (FOL-464): what was made in their name
  // before the inbox's owner took the login back is not theirs anywhere.
  const { accountsOf } = await import("./users.ts");
  const tenants = new Set([person.tenant, ...(await accountsOf(person.id)).map((a) => a.tenant)]);
  const total = { keys: 0, grants: 0, invites: 0 };
  for (const tenant of tenants) {
    const r = await revokeProvisionalIn({ ...person, tenant }, before);
    total.keys += r.keys;
    total.grants += r.grants;
    total.invites += r.invites;
  }
  return total;
}

async function revokeProvisionalIn(person: { id: string; tenant: string; email: string; hash: string }, before: Date): Promise<{ keys: number; grants: number; invites: number }> {
  const older = (at: string | undefined) => !at || Date.parse(at) < before.getTime();
  const by = `reset:${person.email}`;
  const email = person.email.toLowerCase();
  let keys = 0;
  for (const k of await listApiKeys(person.tenant)) {
    if (!k.revokedAt && older(k.createdAt) && (k.createdBy ?? "").toLowerCase() === email && (await revokeApiKey(person.tenant, k.id))) keys++;
  }
  await dropCodesOf(person.tenant, person.id, hashFingerprint(person.hash));
  let grants = 0;
  for (const g of await listGrants(person.tenant)) {
    if (g.userId === person.id && older(g.createdAt) && (await revokeGrant(person.tenant, g.id, by))) grants++;
  }
  // Every pending invite this person made, whatever its scope.
  const invites = (await revokeInvitesBeyond(person.tenant, { id: person.id, email: "" }, { role: "viewer", workspaces: [] }, by, before)).length;
  if (keys + grants + invites) await audit("account.provisional-revoked", { actor: by, tenant: person.tenant, detail: { keys, grants, invites } }).catch(() => undefined);
  return { keys, grants, invites };
}
