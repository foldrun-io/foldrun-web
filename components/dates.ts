// Dates written out for people, one way on every billing and admin page.
//
// UTC on purpose, like money.ts's fixed grouping: these render on the
// server, where the box's own zone is nobody's, and a billing date is the
// ledger's date. A time a person acts on goes through <LocalTime>, which
// knows the viewer's clock; these are for "resets 12 Oct" and "October 2026".

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "12 Oct" — a day this year, from an ISO instant. */
export function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}`;
}

/** "October 2026" — from "2026-10". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] ?? month} ${y}`;
}

/** "Oct 26" — a month in a narrow chip. */
export function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${SHORT[m - 1] ?? month} ${String(y).slice(2)}`;
}
