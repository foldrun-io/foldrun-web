// Saved run searches (FOL-72 step 9): a person's named filters for the runs
// pages and `foldrun runs --view`, kept with them (their preferences). Pure.

export const RUN_VIEWS_PREF = "runViews";
/** The query keys a view may hold — the runs pages' filters and search. */
export const VIEW_KEYS = ["status", "flow", "workspace", "since", "q", "tool", "tool_error", "agent", "model", "min_tokens", "min_secs"];
/** The search's own keys — what the runs pages carry through their links. */
export const SEARCH_KEYS = ["tool", "tool_error", "agent", "model", "min_tokens", "min_secs"];

export interface RunView {
  name: string;
  /** A query string of VIEW_KEYS: "tool=web&tool_error=1". */
  query: string;
}

/** The person's views, as far as they are well-formed. */
export function runViewsOf(prefs: Record<string, unknown> | null | undefined): RunView[] {
  const raw = prefs?.[RUN_VIEWS_PREF];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is RunView => !!v && typeof v === "object" && typeof (v as RunView).name === "string" && typeof (v as RunView).query === "string").slice(0, 20);
}

/** A list to store, or what is wrong with it. Keeps only the known keys. */
export function checkRunViews(raw: unknown): { views: RunView[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "runViews is a list of { name, query }" };
  if (raw.length > 20) return { error: "at most 20 saved views" };
  const views: RunView[] = [];
  for (const v of raw) {
    const name = typeof v?.name === "string" ? v.name.trim() : "";
    if (!name || name.length > 40) return { error: "each view needs a name of 1 to 40 characters" };
    if (views.some((x) => x.name === name)) return { error: `two views are called ${name}` };
    const q = new URLSearchParams(typeof v?.query === "string" ? v.query.replace(/^\?/, "") : "");
    const kept = new URLSearchParams();
    for (const [k, val] of q) if (VIEW_KEYS.includes(k) && val) kept.set(k, val.slice(0, 200));
    if (![...kept.keys()].length) return { error: `view ${name} filters nothing — its query takes ${VIEW_KEYS.join(", ")}` };
    views.push({ name, query: kept.toString() });
  }
  return { views };
}
