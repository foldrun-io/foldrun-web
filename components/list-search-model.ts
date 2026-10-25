// One rule for every list's search box: every word typed must appear
// somewhere in the row's text, in any order, any case. Shared by the
// client-side filter and the pages that filter on the server before
// paging, so a list reads the same whichever side answers.

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesQuery(text: string, query: string): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = normalize(text);
  return terms.every((t) => hay.includes(t));
}

export function filterByQuery<T>(rows: T[], query: string, text: (row: T) => string): T[] {
  if (!normalize(query)) return rows;
  return rows.filter((r) => matchesQuery(text(r), query));
}

/** The page's query string with `q` set (or dropped when empty) and the
 *  page number dropped — a new search starts on page one. */
export function withQuery(search: string, q: string): string {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  params.delete("page");
  if (normalize(q)) params.set("q", q.trim());
  else params.delete("q");
  const s = params.toString();
  return s ? `?${s}` : "";
}
