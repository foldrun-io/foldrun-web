// Support's read-only view of a customer account, as the web layer enforces it.
//
// The grant lives in the platform (support-views.ts); the token is a session
// cookie (users.ts mintSupportSession) that reads as the account's owner,
// marked `viewAs`. While the support person holds it, their own session is
// parked in a second cookie and comes back when the view ends.
//
// Read-only is decided HERE, once, and enforced in the auth funnel every
// route already goes through: resolveTenant (server/auth.ts) for every
// role-gated route, and requireSession / requireOwner / sessionUser
// (server/api.ts) for the ones that act on a person. A route that reads the
// session any other way and writes is refused by a consistency test, so no
// route has to remember.

/** Where the support person's own session waits while they view an account. */
export const SUPPORT_HOME_COOKIE = "foldrun_support_home";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Is this token a support view's? Cheap: no signature, no lookup. */
export const isSupportToken = (token: string | undefined | null): boolean => Boolean(token && token.startsWith("s1."));

/**
 * The writes a support view may still make: ending itself, and signing out.
 * Everything else that is not a GET is refused.
 */
const ALLOWED_WRITES: RegExp[] = [/^\/api\/admin\/accounts\/[^/]+\/view-as$/, /^\/api\/support\/(enter|exit)$/, /^\/api\/auth\/logout$/];

/**
 * Reads that hand over the account's data wholesale. A view is for looking,
 * on screen; a copy of everything leaves with whoever downloads it, so the
 * export stays the owner's own act.
 */
// Reads that hand over data wholesale or a token that ACTS (a webhook URL
// starts runs, a share link publishes): a read-only view must not leave
// with either.
const REFUSED_READS: RegExp[] = [
  /^\/api\/account\/export$/,
  /^\/api\/workspaces\/[^/]+\/export$/,
  /^\/api\/workspaces\/[^/]+\/hooks\/[^/]+$/,
  /^\/api\/workspaces\/[^/]+\/shares(?:\/.*)?$/,
];

export const READ_ONLY_MESSAGE = "read-only: support is viewing this account — changes are refused until the view ends";

/** Why this request is refused under a support view, or null when it may go. */
export function supportViewRefusal(method: string, pathname: string): string | null {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return REFUSED_READS.some((r) => r.test(pathname)) ? "support views cannot export the account's data or read its tokens" : null;
  }
  if (ALLOWED_WRITES.some((r) => r.test(pathname))) return null;
  return READ_ONLY_MESSAGE;
}
