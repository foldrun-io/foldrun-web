// Shared route helpers: resolve the caller's workspace (API key first, dev
// header fallback) and turn thrown errors into the right status code.

import { platform } from "@/lib/platform";
import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant, type Actor } from "./auth.ts";
import { isOwner, verifySession, SESSION_COOKIE, type UserRecord } from "./users.ts";
import { can, ACTIONS, type Action } from "@/platform/permissions.ts";
import { scopeAllows } from "@/platform/scope.ts";
import { supportViewRefusal } from "./view-as.ts";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * The workspace a request is about, read from its path: every workspace
 * route is /api/workspaces/<name>/… . A caller scoped to some workspaces is
 * refused the others here, once, rather than in forty handlers.
 */
function assertScope(req: NextRequest, actor: Actor) {
  if (actor.workspaces === null) return;
  const m = req.nextUrl.pathname.match(/^\/api\/workspaces\/([^/]+)/);
  if (m && !actor.workspaces.includes(decodeURIComponent(m[1]))) {
    throw new ApiError("this workspace is not one you were given access to", 403);
  }
}

/**
 * The same refusal for a workspace a request names in its body or query —
 * the secrets vault, an OAuth connect — which assertScope cannot see in the
 * path. Unsaid means the account's own store, the fallback every workspace
 * reads: a caller scoped to some workspaces may not read or change that.
 */
export function assertWorkspaceScope(actor: Actor, workspace: string | undefined): void {
  if (actor.workspaces === null) return;
  if (workspace === undefined) {
    throw new ApiError("account-level secrets need access to every workspace — name a workspace you were given", 403);
  }
  if (!scopeAllows(actor.workspaces, workspace)) {
    throw new ApiError("this workspace is not one you were given access to", 403);
  }
}

/** The caller and what it may see — for routes that list across workspaces. */
export async function requireCaller(req: NextRequest): Promise<{ tenant: string; actor: Actor }> {
  const auth = await resolveTenant(req);
  if (auth.tenant === null) throw new ApiError(auth.message, auth.status);
  assertScope(req, auth.actor);
  return { tenant: auth.tenant, actor: auth.actor };
}

/**
 * A route that only exists on the hosted edition — the wallet, top-ups, a
 * card. On the `self-hosted` edition it is not forbidden, it is not there: 404,
 * the same answer a typed URL to the wallet page gets. One call at the top
 * of each such handler; tests/consistency.test.ts makes sure it is there.
 */
export function requireHosted(): void {
  if (platform.edition() !== "hosted") throw new ApiError("not found", 404);
}

export async function requireTenant(req: NextRequest): Promise<string> {
  const auth = await resolveTenant(req);
  // Compare against null explicitly — a truthiness check doesn't narrow the
  // AuthResult union, since the success variant's string could be empty.
  if (auth.tenant === null) throw new ApiError(auth.message, auth.status);
  assertScope(req, auth.actor);
  return auth.tenant;
}

/**
 * The tenant, and the caller — refused unless the caller's role may take
 * this action. One call per write route, so "what may a viewer do" has one
 * answer in one table (permissions.ts) rather than a guess per handler.
 *
 * Reads keep requireTenant: every role may read, and a route that only
 * reads has nothing to ask.
 */
export async function requirePermission(
  req: NextRequest,
  action: Action,
): Promise<{ tenant: string; actor: Actor }> {
  const auth = await resolveTenant(req);
  if (auth.tenant === null) throw new ApiError(auth.message, auth.status);
  assertScope(req, auth.actor);
  if (!can(auth.actor.role, action)) {
    throw new ApiError(
      `your role (${auth.actor.role}) cannot do this — it needs ${ACTIONS[action]} or above`,
      403,
    );
  }
  return { tenant: auth.tenant, actor: auth.actor };
}

/**
 * Like requirePermission, but the caller must be a signed-in person, not a
 * key. For acts against a named member — inviting, re-roling, removing,
 * transferring — where "who did this" has to be somebody.
 */
export async function requirePerson(
  req: NextRequest,
  action: Action,
): Promise<{ tenant: string; actor: Actor & { kind: "user" } }> {
  const { tenant, actor } = await requirePermission(req, action);
  if (actor.kind !== "user") throw new ApiError("this action needs a signed-in person, not an API key", 401);
  return { tenant, actor: actor as Actor & { kind: "user" } };
}

/**
 * The person making this request, and only if they own the account.
 *
 * Two refusals, and the second is the interesting one:
 *
 *   · A request with no session is not a person. An API key is an ACCOUNT
 *     credential — it names a tenant and nobody — so it cannot be the actor
 *     for an act against a named person. Removing a teammate is not a thing
 *     a key left in CI should be able to do on its own authority.
 *
 *   · A member who is not the owner is refused. This is the check whose
 *     absence let an invitee delete the founder.
 */
/**
 * The signed-in PERSON, or 401. For the things only a person can do to
 * their own identity — enrol a second factor, resend their verification —
 * where an API key (an account credential, nobody) must not be enough.
 */
export async function requireSession(req: NextRequest): Promise<UserRecord> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new ApiError("sign in first", 401);
  // A support view reads as the owner; it never acts as them.
  const refused = session.viewAs ? supportViewRefusal(req.method, req.nextUrl.pathname) : null;
  if (refused) throw new ApiError(refused, 403);
  return session;
}

/**
 * The signed-in person, for a route that acts on their own identity (their
 * password, email, name, sessions, a CLI sign-in) — null when nobody is
 * signed in, and a ready 403 when the session is support's read-only view
 * and this is a write. The one way such a route reads the session:
 * tests/consistency.test.ts refuses a write handler that calls
 * verifySession itself.
 */
export async function sessionUser(req: NextRequest): Promise<UserRecord | null | NextResponse> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const refused = session?.viewAs ? supportViewRefusal(req.method, req.nextUrl.pathname) : null;
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  return session;
}

export async function requireOwner(req: NextRequest): Promise<{ tenant: string; userId: string }> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    throw new ApiError("this action needs a signed-in owner, not an API key", 401);
  }
  const refused = session.viewAs ? supportViewRefusal(req.method, req.nextUrl.pathname) : null;
  if (refused) throw new ApiError(refused, 403);
  if (!await isOwner(session.tenant, session.id)) {
    throw new ApiError("only the account owner can do this", 403);
  }
  return { tenant: session.tenant, userId: session.id };
}

/**
 * Who is making this request, as a name for a revision's `by`. A signed-in
 * person is their email; a request on an API key is the person the key was
 * minted by (auth.ts), or the key's label when nobody was — never a bare
 * "api-key" while the key knows more.
 */
export async function actorOf(req: NextRequest): Promise<string> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session?.email) return session.email;
  const auth = await resolveTenant(req);
  return auth.tenant !== null ? auth.actor.name : "api-key";
}

/**
 * What a thrown thing means to the caller: a status, and a message that is
 * safe to send.
 *
 * Three kinds arrive here. An ApiError, or a core error carrying a `status`,
 * knows what it is. A plain Error is a refusal written for the caller —
 * "expected { id }", "no such workspace" — and has always been a 400 with
 * its message, which every route and the CLI rely on. Everything else is
 * the server's fault: a TypeError from a bug, an ENOENT with an absolute
 * path in it, an EACCES naming a directory. Those used to go out as 400
 * with the message verbatim, which told the caller their request was wrong
 * (it was not) and told anyone probing the API where the data lives. Now
 * they are a 500 with one generic sentence, and the detail is logged where
 * an operator reads it. ENOENT alone is a 404: a file that is not there is
 * a thing the caller can act on, the path is not.
 */
export function errorStatus(err: unknown): { status: number; message: string; internal: boolean } {
  if (err instanceof ApiError) return { status: err.status, message: err.message, internal: false };
  // Core modules can't import ApiError (they know nothing of HTTP), but a
  // few of their errors carry a `status` for exactly this moment — the
  // ledger's out-of-credits refusal is a 402, not a generic 400.
  const carried = (err as { status?: unknown })?.status;
  if (typeof carried === "number" && err instanceof Error) return { status: carried, message: err.message, internal: false };
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const system = typeof code === "string" && typeof (err as NodeJS.ErrnoException).syscall === "string";
    if (system) {
      if (code === "ENOENT" || code === "ENOTDIR") return { status: 404, message: "not found", internal: true };
      return { status: 500, message: "something went wrong on our side", internal: true };
    }
    if (err instanceof SyntaxError) return { status: 400, message: "malformed JSON", internal: true };
    if (err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError) {
      return { status: 500, message: "something went wrong on our side", internal: true };
    }
    return { status: 400, message: err.message, internal: false };
  }
  return { status: 400, message: String(err), internal: false };
}

/** errorStatus, with a server fault's detail logged — for a route whose
 *  error is not this JSON shape (a page, a webhook's delivery log). */
export function reportError(err: unknown): { status: number; message: string; internal: boolean } {
  const parts = errorStatus(err);
  if (parts.internal) {
    // The detail the caller does not get. Stack when there is one: a 500
    // with no stack is a bug report with no bug in it.
    console.error(`[foldrun] api ${parts.status}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
  return parts;
}

export function errorResponse(err: unknown) {
  const { status, message } = reportError(err);
  return NextResponse.json({ error: message }, { status });
}
