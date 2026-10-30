import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys, revokeApiKey, resolveTenant, parseKeyExpiry, type Actor } from "@/server/auth";
import { audit } from "@/server/audit";
import { verifySession, SESSION_COOKIE, hasUsers, setupTokenRequired, setupTokenMatches } from "@/server/users";
import { sendSecurityNotice } from "@/server/email";
import { clientIp } from "@/server/limits";
import { can, isRole, type Role } from "@/platform/permissions";
import { withinMinter, keyWithin } from "@/server/key-scope";
import { listWorkspaces } from "@/lib/store";
import { errorResponse, ApiError, refuse } from "@/server/api";
import { idempotent } from "@/server/idempotency";

/**
 * Who may touch keys, decided BEFORE any body is read.
 *
 * A signed-in person or a key holder acts on their own account only — the
 * `tenant` a body or query names is ignored for them — and needs
 * `keys:manage` (an admin) to list, mint or revoke: a key that can mint
 * keys is a key that can outlive its own revocation, and a list of key
 * labels and who minted them is an admin's view on the Settings page too.
 * Two callers have no identity and still get in: dev mode, and an install
 * with NO users at all, being set up by whoever reached it first — those
 * name the tenant in the body or query. Once any account exists,
 * unauthenticated key management is refused for every tenant.
 */
// Not requirePermission: that refuses every caller without an identity, and
// the no-users bootstrap below has none. The role check is the same table.
async function authorize(req: NextRequest, claimed: () => Promise<string | undefined>): Promise<{ tenant: string; minter: Pick<Actor, "role" | "workspaces">; who?: string; by: string }> {
  const auth = await resolveTenant(req);
  if (auth.tenant !== null) {
    if (!can(auth.actor.role, "keys:manage")) throw new ApiError(`your role (${auth.actor.role}) cannot manage API keys — it needs admin`, 403);
    // Who is acting: the signed-in person, or the person the key was made
    // for (auth.ts puts that in the actor's name).
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    return { tenant: auth.tenant, minter: { role: auth.actor.role, workspaces: auth.actor.workspaces }, who: session?.email ?? (auth.actor.kind === "key" && !auth.actor.name.startsWith("key:") ? auth.actor.name : undefined), by: session?.email ?? auth.actor.name };
  }
  // Identified and refused (a support view's write): say so, as it is.
  if (auth.status === 403) throw new ApiError(auth.message, 403);
  if (process.env.FOLDRUN_DEV_NO_AUTH === "1" || !(await hasUsers())) {
    // Before the first signup, the setup token guards this door exactly as
    // it guards signup: without it, anyone who reached a fresh self-hosted
    // install minted an owner key there and never needed to sign up at all.
    if (process.env.FOLDRUN_DEV_NO_AUTH !== "1" && (await setupTokenRequired()) && !setupTokenMatches(req.headers.get("x-foldrun-setup-token"))) {
      throw new ApiError("this install is waiting for its first sign-up — use the link the installer printed (or send its setup token as X-Foldrun-Setup-Token)", 401);
    }
    return { tenant: (await claimed()) ?? "default", minter: { role: "owner", workspaces: null }, by: "setup" };
  }
  throw new ApiError(auth.status === 401 && auth.message !== "invalid API key" ? auth.message : "key management requires a valid key for this workspace", 401);
}

export async function GET(req: NextRequest) {
  try {
    const { tenant, minter } = await authorize(req, async () => req.nextUrl.searchParams.get("tenant") ?? undefined);
    // A scoped admin sees the keys it could have minted, not the account's.
    return NextResponse.json({ keys: (await listApiKeys(tenant)).filter((k) => keyWithin(minter, k)) });
  } catch (err) {
    return errorResponse(err);
  }
}

async function postOnce(req: NextRequest) {
  try {
    // The body is read once, lazily: an identified caller never needs its
    // `tenant`, and an unidentified one is refused before parsing anything.
    let parsed: Record<string, unknown> | undefined;
    const bodyOf = async () => (parsed ??= ((await req.json()) ?? {}) as Record<string, unknown>);
    const { tenant, minter, who, by } = await authorize(req, async () => (await bodyOf()).tenant as string | undefined);
    const body = (await bodyOf()) as {
      tenant?: string;
      label?: string;
      /** A deploy key, once: one workspace, for the platform's own git.
       *  Refused since that git went (17 Oct 2026); still read, so a
       *  caller that sends it hears why rather than getting an account key. */
      workspace?: string;
      access?: "read" | "write";
      /** What the key may do: viewer, editor (default) or admin. Never
       *  above the minter's own role. */
      role?: Role;
      /** Which workspaces the key opens: a list, or null for all. Unsaid,
       *  it is the minter's own scope. Never wider than the minter's. */
      workspaces?: string[] | null;
      /** When it stops working: "30d", "90d", "365d", a number of days,
       *  or "never" (the default). */
      expires?: string | number | null;
    };
    if (body.workspace !== undefined || body.access !== undefined) {
      return refuse("deploy keys went with the platform's own git (17 Oct 2026) — mint an account key with workspaces: [\"<ws>\"] to open one workspace", 400);
    }
    const expiresAt = parseKeyExpiry(body.expires);
    const role: Role = isRole(body.role) && body.role !== "owner" ? body.role : "editor";
    let asked: string[] | null | undefined;
    if (body.workspaces === null) asked = null;
    else if (Array.isArray(body.workspaces)) {
      asked = body.workspaces.filter((w): w is string => typeof w === "string");
      const have = listWorkspaces(tenant).map((w) => w.name);
      const unknown = asked.filter((w) => !have.includes(w));
      if (unknown.length) return refuse(`no such workspace: ${unknown.join(", ")}`, 400);
    }
    // Never a role above the minter's, never a workspace they cannot open:
    // a workspace-scoped admin used to be able to mint an unscoped key
    // and open the rest of the account with it.
    const grant = withinMinter(minter, { role, workspaces: asked });
    const { record, key } = await createApiKey(tenant, body.label ?? "", who, undefined, grant.role, grant.workspaces, { expiresAt });
    await audit("apikey.created", {
      actor: by,
      tenant,
      subject: record.id,
      detail: { label: record.label, prefix: record.prefix, role: record.role, workspaces: record.workspaces ?? null, expiresAt: record.expiresAt ?? null },
    });
    if (who) sendSecurityNotice(tenant, who, "a new API key was created", clientIp(req));
    return NextResponse.json({ ok: true, key, id: record.id, prefix: record.prefix, role: record.role, workspaces: record.workspaces ?? null, expiresAt: record.expiresAt ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    let parsed: Record<string, unknown> | undefined;
    const bodyOf = async () => (parsed ??= ((await req.json()) ?? {}) as Record<string, unknown>);
    const body = (await bodyOf()) as { id?: string };
    if (!body.id) throw new ApiError("expected { id }", 400);

    // A key may always revoke ITSELF, whatever its role. `foldrun login` mints
    // a key at the person's own role — often viewer or editor — so `foldrun
    // logout` must be able to end it without keys:manage, which only admins
    // have. Self-revocation is the opposite of the escalation the gate guards
    // against: it cannot mint, cannot touch another key, cannot outlive
    // anything. Checked before authorize so a non-admin is not refused first.
    const self = await resolveTenant(req);
    if (self.tenant !== null && self.actor.kind === "key" && self.actor.id === body.id) {
      const own = (await listApiKeys(self.tenant)).find((k) => k.id === body.id);
      if (!own || !(await revokeApiKey(self.tenant, body.id))) throw new ApiError("key not found", 404);
      await audit("apikey.revoked", { actor: self.actor.name, tenant: self.tenant, subject: own.id, detail: { label: own.label, prefix: own.prefix, self: true } });
      return NextResponse.json({ ok: true });
    }

    const { tenant, minter, by } = await authorize(req, async () => (await bodyOf()).tenant as string | undefined);
    // Revoking is the mint rule read backwards: a key outside the caller's
    // own scope is not theirs to see, so it is not found rather than refused.
    const target = (await listApiKeys(tenant)).find((k) => k.id === body.id);
    if (!target || !keyWithin(minter, target)) throw new ApiError("key not found", 404);
    if (!(await revokeApiKey(tenant, body.id))) throw new ApiError("key not found", 404);
    await audit("apikey.revoked", { actor: by, tenant, subject: target.id, detail: { label: target.label, prefix: target.prefix } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args), { secretFields: ["key"] });
}
