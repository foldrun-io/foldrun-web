// Whether a card in a long list is open, and where that is remembered.
//
// Pure, so it can be tested without a browser: the component hands in
// whatever storage it could reach (or null), and every read and write here
// survives that storage throwing — a private window, blocked site data, a
// quota — by falling back to the default. The page must render the same
// with no storage at all; storage only makes a viewer's choice stick.

/** The slice of Storage this needs, so tests can pass a fake. */
export type CollapseStorage = Pick<Storage, "getItem" | "setItem">;

const PREFIX = "foldrun.collapse";

/** ListSearch announces each query on this window event; collapsed cards it matches open. */
export const LIST_SEARCH_EVENT = "foldrun:list-search";

/** One key per page and item: `foldrun.collapse.<scope>.<item>`. */
export function collapseKey(scope: string, item: string): string {
  return `${PREFIX}.${scope}.${item}`;
}

/** The remembered choice, or null when there is none or storage refused. */
export function readStored(storage: CollapseStorage | null | undefined, key: string): boolean | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/** Remember a choice. False when storage refused — the caller keeps it in memory. */
export function writeStored(storage: CollapseStorage | null | undefined, key: string, open: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, open ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the card is open, in order of who wins:
 *
 *   manual   the viewer clicked it this visit — always honoured
 *   forced   something needs it seen: a search matched it, the URL's #anchor
 *            names it, the page says it has errors
 *   stored   what this viewer chose last time
 *   default  collapsed, unless the page says otherwise
 */
export function resolveOpen({
  manual = null,
  forced = false,
  stored = null,
  defaultOpen = false,
}: {
  manual?: boolean | null;
  forced?: boolean;
  stored?: boolean | null;
  defaultOpen?: boolean;
}): boolean {
  if (manual !== null) return manual;
  if (forced) return true;
  if (stored !== null) return stored;
  return defaultOpen;
}

/** Does the URL's hash name this card? `#flow-digest` targets id `flow-digest`. */
export function hashTargets(hash: string, id: string): boolean {
  if (!hash || !id) return false;
  try {
    return decodeURIComponent(hash.replace(/^#/, "")) === id;
  } catch {
    return hash.replace(/^#/, "") === id;
  }
}

/** A string safe to use as an element id and an #anchor. */
export function anchorId(prefix: string, name: string): string {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
