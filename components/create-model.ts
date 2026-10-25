// Where the create dialog goes once the thing exists. A workspace answers
// with its own dashboard, and that is where the person meant to be: staying
// on the account page left the switcher's list stale (it refetches on
// navigation, and a refresh is not one) and the new workspace out of reach
// until a reload. Anything else answers without a page and stays put.

/** The page to open after a create, from the API's answer — or null. Only a
 *  same-site dashboard path is followed, never a URL the body happens to hold. */
export function createdHref(answer: unknown): string | null {
  const href = (answer as { dashboard?: unknown } | null)?.dashboard;
  return typeof href === "string" && href.startsWith("/dashboard/") ? href : null;
}
