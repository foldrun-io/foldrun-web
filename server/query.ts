// Reading numbers off a query string without letting the string decide.
//
// `Number("abc")` is NaN, `.slice(0, NaN)` is an empty list, and a negative
// limit slices from the end — so `?limit=abc` returned nothing and
// `?limit=-5` returned the oldest five, both with a 200. A query parameter
// is a suggestion; the route says what range it will honour.

/** An integer in [min, max], or `fallback` when the text is not one. A
 *  number outside the range is clamped rather than refused: `limit=9999`
 *  means "as many as you'll give me", not an error. */
export function intParam(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw === null || raw === undefined || !/^-?\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Math.min(max, Math.max(min, n));
}
