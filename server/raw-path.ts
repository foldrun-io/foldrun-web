// What an /api/ path may never hold, read from the RAW path (still
// percent-encoded) before any route sees it.
//
// Next decodes each dynamic segment with decodeURIComponent, so `%2F` in a
// segment reaches a route as `/`, and a name joined to a folder becomes a
// path: `..%2F..%2F<tenant>%2F…` (30 Oct 2026 review: agents/<agent>/run,
// hooks/<name>/test). Each route checks its own names too; this is the
// floor under all of them. No route under app/api has a catch-all segment
// — every dynamic segment is one name ([workspace], [agent], [id], …) and
// every file path rides in the query string (`?path=`) — so no request a
// client of ours makes needs any of what this refuses.

/** Why this raw pathname is refused, or null when it is fine. */
export function unsafeApiPath(rawPathname: string): string | null {
  // An encoded separator or NUL anywhere: never one name.
  if (/%(2f|5c|00)/i.test(rawPathname)) return "a path segment may not hold an encoded /, \\ or NUL";
  for (const raw of rawPathname.split("/")) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return "a path segment is not valid percent-encoding";
    }
    if (seg === "." || seg === "..") return "a path segment may not be . or ..";
    if (/[\\\0]/.test(seg)) return "a path segment may not hold \\ or NUL";
  }
  return null;
}
