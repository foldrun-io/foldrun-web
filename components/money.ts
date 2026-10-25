// Dollars, formatted one way everywhere.
//
// Not toLocaleString: that reads the BOX's locale on the server, and the
// consistency suite reserves locale formatting for the one place that knows
// which clock and calendar the viewer chose. Money is not localised here —
// the ledger is in US dollars and every figure says so — so a fixed
// grouping is the honest rendering, and it is the same on the server as in
// the browser.

/** "$1,234.56". Two decimals always: a statement column has to line up. */
export function usd(n: number): string {
  const sign = n < 0 ? "−" : "";
  const [whole, frac] = Math.abs(n).toFixed(2).split(".");
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/**
 * A ledger line's amount, carrying exactly one sign.
 *
 * `usd()` already renders the minus for a negative, so a caller prefixing
 * its own produced "−−$0.18" on the statement. Only money coming IN gets a
 * "+"; zero gets neither, because a run that was waived is not a payment
 * and showing it as `+$0.00` in credit-green said it was.
 */
export function signedUsd(n: number): string {
  return n > 0 ? `+${usd(n)}` : usd(n);
}

/** The exact figure, for a hover: every micro-dollar the ledger holds. */
export function usdExact(n: number): string {
  const s = Math.abs(n).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${n < 0 ? "−" : ""}$${s}`;
}

/** Short, for chrome: "$142", "$1.2k". */
export function usdShort(n: number): string {
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  return `$${n.toFixed(2)}`;
}

// ---------------------------------------------------------------- credits

/** One credit is one cent — plans.ts is the authority; this is the
 *  renderer. "12,340 credits". */
export function credits(usd: number): string {
  const n = Math.round(usd / 0.01);
  const sign = n < 0 ? "−" : "";
  const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped} credit${Math.abs(n) === 1 ? "" : "s"}`;
}

/** Short, for chrome: "12.3k credits", "840 credits". */
export function creditsShort(usd: number): string {
  const n = Math.round(usd / 0.01);
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 10_000) return `${sign}${(a / 1000).toFixed(1)}k credits`;
  return `${sign}${String(a).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} credits`;
}

// ---------------------------------------------------------------- counts

/** "12,340" — a whole number with the same grouping as the money. */
export function grouped(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
