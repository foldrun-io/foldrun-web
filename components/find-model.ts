// The Find palette's reading of a query: what matches, how well, in what
// order, under which heading. Pure, shared by the search API (server) and
// the palette (client) so both rank the same way; tests/find.test.ts pins it.

export type FindKind =
  | "workspace"
  | "agent"
  | "flow"
  | "tool"
  | "hook"
  | "skill"
  | "knowledge"
  | "memory"
  | "run"
  | "page";

export interface FindHit {
  kind: FindKind;
  title: string;
  /** One line under the title: a description, a flow's trigger, a run's headline. */
  subtitle?: string;
  href: string;
  /** Which workspace this lives in — shown as a chip; absent for account-level things. */
  workspace?: string;
  /** For runs: the display status, so the row can carry a dot. */
  status?: string;
  score?: number;
}

/** Heading order in the palette — what you most often jump to first. */
export const KIND_ORDER: FindKind[] = ["workspace", "agent", "flow", "run", "tool", "hook", "skill", "knowledge", "memory", "page"];

export const KIND_LABEL: Record<FindKind, string> = {
  workspace: "Workspaces",
  agent: "Agents",
  flow: "Flows",
  run: "Runs",
  tool: "Tools",
  hook: "Hooks",
  skill: "Skills",
  knowledge: "Knowledge",
  memory: "Memory",
  page: "Pages",
};

const norm = (s: string) => s.trim().toLowerCase();

/** Every character of `q` appears in `s`, in order — "wkly" finds "weekly". */
function subsequence(q: string, s: string): boolean {
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

/**
 * How well a hit answers a query. 0 is no match. Title matches outrank
 * subtitle matches, a prefix outranks a substring, and a word-start
 * substring outranks one buried mid-word. A subsequence match is the floor:
 * enough to find "leads-desk" from "ldsk", never enough to outrank a real one.
 */
export function scoreHit(query: string, title: string, subtitle = ""): number {
  const q = norm(query);
  if (!q) return 1;
  const t = norm(title);
  const s = norm(subtitle);
  if (t === q) return 10;
  if (t.startsWith(q)) return 8;
  if (t.includes(`-${q}`) || t.includes(` ${q}`) || t.includes(`_${q}`) || t.includes(`/${q}`)) return 6;
  if (t.includes(q)) return 5;
  if (s.startsWith(q)) return 3;
  if (s.includes(` ${q}`)) return 2.5;
  if (s.includes(q)) return 2;
  if (q.length >= 3 && subsequence(q, t)) return 1;
  return 0;
}

/** Score, drop the misses, best first, at most `perKind` under each heading. */
export function rank(hits: FindHit[], query: string, perKind = 6): FindHit[] {
  const scored = hits
    .map((h) => ({ ...h, score: scoreHit(query, h.title, h.subtitle) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const count = new Map<FindKind, number>();
  return scored.filter((h) => {
    const n = count.get(h.kind) ?? 0;
    if (n >= perKind) return false;
    count.set(h.kind, n + 1);
    return true;
  });
}

export function groupHits(hits: FindHit[]): { kind: FindKind; label: string; hits: FindHit[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], hits: hits.filter((h) => h.kind === kind) })).filter(
    (g) => g.hits.length > 0,
  );
}

/**
 * The dashboard's own doors, as hits — so the palette is also a way to get
 * anywhere. Inside a workspace its pages come first; the account's follow.
 */
export function pagesFor(workspace: string | null, qs: string): FindHit[] {
  const q = (first: boolean) => (first ? (qs ? `?${qs}` : "") : qs ? `&${qs}` : "");
  const ws: FindHit[] = workspace
    ? [
        { kind: "page", title: `${workspace} · Overview`, href: `/dashboard/${workspace}${q(true)}` },
        { kind: "page", title: `${workspace} · Agents`, href: `/dashboard/${workspace}/agents${q(true)}` },
        { kind: "page", title: `${workspace} · Flows`, href: `/dashboard/${workspace}/flows${q(true)}` },
        { kind: "page", title: `${workspace} · Evals`, href: `/dashboard/${workspace}/evals${q(true)}` },
        { kind: "page", title: `${workspace} · Tools`, href: `/dashboard/${workspace}/assets?kind=tools${q(false)}` },
        { kind: "page", title: `${workspace} · Knowledge`, href: `/dashboard/${workspace}/assets?kind=knowledge${q(false)}` },
        { kind: "page", title: `${workspace} · Memory`, href: `/dashboard/${workspace}/assets?kind=memory${q(false)}` },
        { kind: "page", title: `${workspace} · Skills`, href: `/dashboard/${workspace}/assets?kind=skills${q(false)}` },
        { kind: "page", title: `${workspace} · Files`, href: `/dashboard/${workspace}/edit${q(true)}` },
        { kind: "page", title: `${workspace} · Storage`, href: `/dashboard/${workspace}/storage${q(true)}` },
        { kind: "page", title: `${workspace} · Graph`, href: `/dashboard/${workspace}/graph${q(true)}` },
        { kind: "page", title: `${workspace} · Runs`, href: `/dashboard/${workspace}/runs${q(true)}` },
        { kind: "page", title: `${workspace} · Observe`, href: `/dashboard/${workspace}/observe${q(true)}` },
        { kind: "page", title: `${workspace} · Triggers`, href: `/dashboard/${workspace}/triggers${q(true)}` },
        { kind: "page", title: `${workspace} · History`, href: `/dashboard/${workspace}/history${q(true)}` },
        { kind: "page", title: `${workspace} · Settings`, href: `/dashboard/${workspace}/settings${q(true)}` },
      ]
    : [];
  const account: FindHit[] = [
    { kind: "page", title: "Account · Overview", subtitle: "every workspace", href: `/dashboard${q(true)}` },
    { kind: "page", title: "Account · Runs", subtitle: "every run across every workspace", href: `/dashboard/runs${q(true)}` },
    { kind: "page", title: "Account · Graph", href: `/dashboard/graph${q(true)}` },
    { kind: "page", title: "Account · Storage", href: `/dashboard/storage${q(true)}` },
    { kind: "page", title: "Shared · Tools", href: `/dashboard/library?kind=tools${q(false)}` },
    { kind: "page", title: "Shared · Skills", href: `/dashboard/library?kind=skills${q(false)}` },
    { kind: "page", title: "Shared · Knowledge", href: `/dashboard/library?kind=knowledge${q(false)}` },
    { kind: "page", title: "Shared · Memory", href: `/dashboard/library?kind=memory${q(false)}` },
    { kind: "page", title: "Usage", subtitle: "tokens, compute, storage", href: `/dashboard/usage${q(true)}` },
    { kind: "page", title: "Billing", subtitle: "balance, runway, add credit", href: `/dashboard/billing${q(true)}` },
    { kind: "page", title: "Statement", subtitle: "every charge and payment, by month", href: `/dashboard/billing/statement${q(true)}` },
    { kind: "page", title: "Invoices", subtitle: "receipts and monthly statements", href: `/dashboard/billing/invoices${q(true)}` },
    { kind: "page", title: "Payment method", subtitle: "card, auto top-up, billing details", href: `/dashboard/billing/payment${q(true)}` },
    { kind: "page", title: "Spend limits", subtitle: "monthly caps and their warnings", href: `/dashboard/limits${q(true)}` },
    { kind: "page", title: "Settings", subtitle: "team, keys, account", href: `/dashboard/settings${q(true)}` },
    { kind: "page", title: "Profile", href: `/dashboard/profile${q(true)}` },
    { kind: "page", title: "Docs", href: `/dashboard/docs${q(true)}` },
    { kind: "page", title: "Help", href: `/dashboard/help${q(true)}` },
  ];
  return [...ws, ...account];
}
