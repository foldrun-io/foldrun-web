// Rotate one key: a new key with the same label, role, workspaces and
// deploy scope, and the old one ended — now, or after a grace long enough
// to move a CI job across.
//
//   POST /api/keys/<id>/rotate  { grace: "0" | "1h" | "24h" }
//
// A key a rotation already replaced is refused, 409 "this key was already
// rotated to <prefix>; rotate that one" (rotateApiKey): rotating it again
// would mint a third key and leave the one whose secret was lost working.
//
// A `foldrun login` key may rotate ITSELF, whatever its role (FOL-71, the
// rotation twin of FOL-66's self-revoke): the CLI renews it before its 90
// days end. Same label, role and workspaces — a rotation never widens — and
// the old key ends SELF_GRACE_MS later, so a CLI that could not save the new
// one still answers on the old one long enough to try again: a retry with the
// old key inside that grace rotates the replacement, if nobody has used it.
// Only a key marked cli-login: a person's CI key keeps the end its owner chose.

import { NextRequest, NextResponse } from "next/server";
import { listApiKeys, rotateApiKey, parseGrace, resolveTenant } from "@/server/auth";
import { keyWithin } from "@/server/key-scope";
import { errorResponse, requirePermission, ApiError } from "@/server/api";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";

const SELF_GRACE_MS = 10 * 60_000;
const LOST_AFTER_MS = 30_000;

async function postOnce(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const self = await resolveTenant(req);
    if (self.tenant !== null && self.actor.kind === "key" && self.actor.id === id) {
      const keys = await listApiKeys(self.tenant);
      const own = keys.find((k) => k.id === id);
      if (own?.origin === "cli-login" && !own.revokedAt) {
        // A retry inside the grace: the CLI never stored the key the first
        // renewal made (the answer was lost, or the save failed), so it asks
        // again with the old one. Rotating the old key again is refused (it
        // names its replacement), so the newest replacement is rotated
        // instead — following earlier retries, each ended unused — and the
        // CLI gets a key it can keep. Only one nobody has used and that is
        // LOST_AFTER_MS old: a CLI that stored its key calls with it at once,
        // so a younger one may be another command's, saved a moment ago.
        let next = own.replacedBy ? keys.find((k) => k.id === own.replacedBy) : undefined;
        for (let hops = 0; next?.replacedBy && next.revokedAt && !next.lastUsedAt && hops < 10; hops++) {
          const after: string = next.replacedBy;
          next = keys.find((k) => k.id === after);
        }
        const retry =
          next?.origin === "cli-login" && !next.revokedAt && !next.replacedBy && !next.lastUsedAt && Date.now() - Date.parse(next.createdAt) >= LOST_AFTER_MS ? next : null;
        const from = retry ?? own;
        const graceMs = retry ? 0 : SELF_GRACE_MS;
        const { record, key, oldEndsAt } = await rotateApiKey(self.tenant, from.id, graceMs, own.createdBy);
        await audit("apikey.rotated", {
          actor: self.actor.name,
          tenant: self.tenant,
          subject: record.id,
          detail: { label: record.label, prefix: record.prefix, replaces: from.id, replacesPrefix: from.prefix, oldEndsAt, graceMs, expiresAt: record.expiresAt ?? null, self: true, ...(retry ? { retryOf: id } : {}) },
        });
        return NextResponse.json({ ok: true, key, id: record.id, prefix: record.prefix, role: record.role, workspaces: record.workspaces ?? null, expiresAt: record.expiresAt ?? null, replaced: { id: from.id, endsAt: oldEndsAt } });
      }
    }
    const { tenant, actor } = await requirePermission(req, "keys:manage");
    const body = ((await req.json().catch(() => ({}))) ?? {}) as { grace?: string | number };
    const graceMs = parseGrace(body.grace);
    // The mint rule read backwards, as for revoke: a key outside the
    // caller's own scope is not theirs to see, so it is not found.
    const target = (await listApiKeys(tenant)).find((k) => k.id === id);
    // A key revoked by a no-grace rotation is still answered by
    // rotateApiKey's 409 naming its replacement; one revoked outright is gone.
    if (!target || (target.revokedAt && !target.replacedBy) || !keyWithin({ role: actor.role, workspaces: actor.workspaces }, target)) throw new ApiError("key not found", 404);
    const who = actor.kind === "user" || !actor.name.startsWith("key:") ? actor.name : undefined;
    const { record, key, oldEndsAt } = await rotateApiKey(tenant, id, graceMs, who);
    await audit("apikey.rotated", {
      actor: actor.name,
      tenant,
      subject: record.id,
      detail: { label: record.label, prefix: record.prefix, replaces: id, replacesPrefix: target.prefix, oldEndsAt, graceMs, expiresAt: record.expiresAt ?? null },
    });
    return NextResponse.json({
      ok: true,
      key,
      id: record.id,
      prefix: record.prefix,
      role: record.role,
      workspaces: record.workspaces ?? null,
      expiresAt: record.expiresAt ?? null,
      replaced: { id, endsAt: oldEndsAt },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. A retried
 *  rotate must not mint a second key and end the first one twice. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args), { secretFields: ["key"] });
}
