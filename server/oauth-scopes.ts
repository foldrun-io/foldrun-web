// The `scopes` a connect or reconnect may ask for instead of the client's
// default: any provider's words, space-separated, as the provider spells
// them. Checked only for shape — foldrun knows no provider's scope list.

/** null when not given; an Error when given wrong. */
export function scopesOf(raw: unknown): string | null | Error {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return new Error("scopes is a string — space-separated, as the provider spells them");
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return new Error("scopes is empty — leave it out to use the client's default");
  if (s.length > 2000) return new Error("scopes is over 2000 characters");
  if (/[\u0000-\u001f\u007f]/.test(s)) return new Error("scopes holds a control character");
  return s;
}
