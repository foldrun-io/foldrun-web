// How the Usage page writes its figures, so the tabs agree (FOL-125).

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Credits are whole at a glance and exact when small: "12,340", "0.35". */
export function fmtCredits(n: number): string {
  const v = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [whole, frac] = String(v).split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

/** A quantity of a meter: three decimals at most, grouped. */
export function fmtQuantity(n: number | null): string {
  if (n === null) return "—";
  const [whole, frac] = String(Math.round(n * 1000) / 1000).split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

/** What a meter's rate is per: stored files are priced over a month. */
export const rateUnit = (meter: string, unit: string) => (meter === "storage" ? "GB-month" : unit);

export const METER_NAMES: Record<string, string> = {
  vcpu: "vCPU",
  ram: "RAM",
  disk: "Step disk",
  storage: "Storage",
  network: "Network",
  pods: "Search and browser pods",
};

export const SUPPLY_NAMES: Record<string, string> = {
  foldrun: "foldrun's models",
  operator: "operator's key",
  own: "your own key",
};

/** "2026-11-01" → the query the tabs share. */
export function periodQuery(tenant: string, tab: string, from?: string, to?: string): string {
  const q = new URLSearchParams();
  if (tenant !== "default") q.set("tenant", tenant);
  if (tab !== "overview") q.set("tab", tab);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const s = q.toString();
  return `/dashboard/usage${s ? `?${s}` : ""}`;
}
