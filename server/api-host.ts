// The route contract of the API host (the one-API plan, 21 Nov 2026):
// which of the platform's `/v1/*` routes the API host serves, and which
// stay on the dashboard host alone.
//
// The API host takes a bearer credential only — an API key or an OAuth
// access token — never a session cookie, and answers no credentialed CORS.
// So a route whose caller is a person in a browser (sign-in, MFA, a card
// form, an approve page), a mailed link, or something in the cluster has no
// business there. Everything else is the platform API a program calls.
//
// Nothing routes by this yet: it is the contract the API host's ingress and
// the request proxy are built from, and tests/api-host.test.ts holds every
// route in server/openapi-routes.ts to it — a new route is served on the
// API host unless a rule here, with its reason, says it is the dashboard's.

/** Why a path is the dashboard's alone. The first matching rule decides. A
 *  rule with `methods` keeps only those methods off the API host: the path's
 *  other methods are served (a key may read what only a session may change).
 *  The billing calls the CLI makes with a key (checkout, card, portal,
 *  subscribe) are served: they answer JSON, and the links they hand back
 *  lead to the dashboard. So are the calls no person's browser holds a
 *  session for (23 Nov 2026, owner: every API call on the API host): the
 *  open sign-up switches foldrun.io reads, Stripe's webhook and foldrun.ir's
 *  signed storefront calls. */
export const DASHBOARD_ONLY: ReadonlyArray<readonly [prefix: string, reason: string, methods?: readonly string[]]> = [
  ["/v1/auth", "a person's own sign-in, password, MFA and sessions: a browser session, a key is refused"],
  ["/v1/unsubscribe", "a link in a mail, opened in a browser"],
  ["/v1/approve", "the approve link in a mail, opened in a browser"],
  ["/v1/avatars", "images for the dashboard's pages"],
  ["/v1/metrics", "Prometheus, scraped inside the cluster"],
  ["/v1/cli/authorize", "the page where a signed-in person approves a CLI login"],
  ["/v1/mcp/oauth/authorize", "the page where a signed-in person approves an app"],
  ["/v1/oauth/start", "starts a provider sign-in in the person's browser"],
  ["/v1/oauth/callback", "where a provider sends the person's browser back"],
  ["/v1/oauth/handoff", "a person's browser picking up a finished provider sign-in"],
  ["/v1/account/close", "closing the account: the owner, signed in, never a key"],
  ["/v1/me/onboarding", "ticking off getting-started is the person's own, in the dashboard; a key may read it", ["PATCH"]],
  ["/v1/team/transfer", "handing the account to someone else: the owner, in a browser"],
  ["/v1/billing/confirm", "Stripe's return to the dashboard after a payment"],
  ["/v1/support", "an operator's support view (hosted): its one-use ticket turns into a session cookie, which only the dashboard's address can set"],
];

/** `/v1/x` matches the prefix `/v1/x` itself and anything under it — not `/v1/xy`. */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The rule that keeps a path (or, given one, a method of it) off the API
 *  host, or null when the API host serves it. With no method, a rule for
 *  some methods only does not count: the path itself is served. */
export function dashboardOnly(path: string, method?: string): { prefix: string; reason: string } | null {
  for (const [prefix, reason, methods] of DASHBOARD_ONLY) {
    if (!under(path, prefix)) continue;
    if (methods && (!method || !methods.includes(method.toUpperCase()))) continue;
    return { prefix, reason };
  }
  return null;
}

/** Does the API host serve this path (this method of it)? Only `/v1/*` is the platform API at all. */
export function apiHostServes(path: string, method?: string): boolean {
  return under(path, "/v1") && path !== "/v1" && dashboardOnly(path, method) === null;
}
