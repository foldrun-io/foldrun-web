// The route contract of the API host (the one-API plan, 21 Nov 2026):
// which of the platform's `/api/*` routes the API host serves, and which
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
 *  lead to the dashboard. */
export const DASHBOARD_ONLY: ReadonlyArray<readonly [prefix: string, reason: string, methods?: readonly string[]]> = [
  ["/api/auth", "a person's own sign-in, password, MFA and sessions: a browser session, a key is refused"],
  ["/api/signup", "the sign-up page's own call, before there is any credential"],
  ["/api/unsubscribe", "a link in a mail, opened in a browser"],
  ["/api/approve", "the approve link in a mail, opened in a browser"],
  ["/api/avatars", "images for the dashboard's pages"],
  ["/api/metrics", "Prometheus, scraped inside the cluster"],
  ["/api/cli/authorize", "the page where a signed-in person approves a CLI login"],
  ["/api/mcp/oauth/authorize", "the page where a signed-in person approves an app"],
  ["/api/oauth/start", "starts a provider sign-in in the person's browser"],
  ["/api/oauth/callback", "where a provider sends the person's browser back"],
  ["/api/oauth/handoff", "a person's browser picking up a finished provider sign-in"],
  ["/api/account/close", "closing the account: the owner, signed in, never a key"],
  ["/api/me/onboarding", "ticking off getting-started is the person's own, in the dashboard; a key may read it", ["PATCH"]],
  ["/api/team/transfer", "handing the account to someone else: the owner, in a browser"],
  ["/api/billing/confirm", "Stripe's return to the dashboard after a payment"],
  ["/api/billing/stripe", "Stripe's own webhook, at the address Stripe was given"],
  ["/api/billing/partner", "foldrun.ir's signed storefront calls, at the address it was given"],
];

/** `/api/x` matches the prefix `/api/x` itself and anything under it — not `/api/xy`. */
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

/** Does the API host serve this path (this method of it)? Only `/api/*` is the platform API at all. */
export function apiHostServes(path: string, method?: string): boolean {
  return under(path, "/api") && path !== "/api" && dashboardOnly(path, method) === null;
}
