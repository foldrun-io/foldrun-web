import { $t } from "@/i18n";
// Saved run searches (FOL-72 step 9): a person's named filters for the runs
// pages and `foldrun runs --view`, kept with them (their preferences). Pure.

export const RUN_VIEWS_PREF = "runViews";
/** The query keys a view may hold — the runs pages' filters and search. */
export const VIEW_KEYS = ["status", "flow", "workspace", "since", "q", "tool", "tool_error", "agent", "model", "min_tokens", "min_secs", "context", "customer"];
/** The search's own keys — what the runs pages carry through their links. */
export const SEARCH_KEYS = ["tool", "tool_error", "agent", "model", "min_tokens", "min_secs", "context", "customer"];

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
  if (!Array.isArray(raw)) return { error: $t("components.run-views-model.runviewsIsAListOfName") };
  if (raw.length > 20) return { error: $t("components.run-views-model.atMost20SavedViews") };
  const views: RunView[] = [];
  for (const v of raw) {
    const name = typeof v?.name === "string" ? v.name.trim() : "";
    if (!name || name.length > 40) return { error: $t("components.run-views-model.eachViewNeedsANameOf") };
    if (views.some((x) => x.name === name)) return { error: $t("components.run-views-model.twoViewsAreCalled", { name: String(name) }) };
    const q = new URLSearchParams(typeof v?.query === "string" ? v.query.replace(/^\?/, "") : "");
    const kept = new URLSearchParams();
    for (const [k, val] of q) if (VIEW_KEYS.includes(k) && val) kept.set(k, val.slice(0, 200));
    if (![...kept.keys()].length) return { error: $t("components.run-views-model.viewFiltersNothingItsQueryTakes", { name: String(name), v1: String(VIEW_KEYS.join(", ")) }) };
    views.push({ name, query: kept.toString() });
  }
  return { views };
}
