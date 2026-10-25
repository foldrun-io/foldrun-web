// Your inbox: everything waiting on you across your workspaces, in one list
// (server/inbox.ts — the same as GET /api/me/inbox and `foldrun inbox`).
// Three tabs that never mix: assigned to you, runs you started, and the rest
// of what waits in your workspaces; a fourth for what you set aside.

import Link from "next/link";
import { PageHeader, EmptyScreen } from "@/components/ui";
import { viewerEmail, viewerRole, viewerScope } from "@/server/users";
import { inboxFor, type InboxItem, type InboxKind } from "@/server/inbox";
import { InboxList } from "@/components/inbox-list";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "mine", label: "For me", hint: "You are named as an approver, you own the flow or agent, or you asked for it." },
  { key: "started", label: "Started by me", hint: "Runs you started: a failure or BLOCKED this week, a gate or a question on one." },
  { key: "team", label: "Team", hint: "Everything else waiting in your workspaces, for whoever picks it up." },
  { key: "dismissed", label: "Set aside", hint: "What you hid from your view. Each one is still waiting where it lives." },
] as const;
type Tab = (typeof TABS)[number]["key"];

const KINDS: { key: InboxKind; label: string }[] = [
  { key: "approval", label: "Approvals" },
  { key: "question", label: "Questions" },
  { key: "issue", label: "Issues" },
  { key: "proposal", label: "Proposed fixes" },
  { key: "run", label: "Your runs" },
];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tenant?: string; tab?: string; kind?: string }> }) {
  const { tenant = "default", tab: tabParam, kind: kindParam } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "mine";
  const kind = KINDS.some((k) => k.key === kindParam) ? (kindParam as InboxKind) : null;
  const person = await viewerEmail();

  if (!person) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader title="Inbox" subtitle="What is waiting on you, across your workspaces." />
        <EmptyScreen title="Sign in to see your inbox" description="An inbox is a person's: what you approve, what you own, what you started. Nobody is signed in here." />
      </main>
    );
  }

  const view = await inboxFor(tenant, person, await viewerScope(), { role: await viewerRole() });
  const inTab = (i: InboxItem) => (tab === "dismissed" ? i.dismissed : !i.dismissed && i.bucket === tab);
  const items = view.items.filter((i) => inTab(i) && (!kind || i.kind === kind));
  const count = (t: Tab) => view.items.filter((i) => (t === "dismissed" ? i.dismissed : !i.dismissed && i.bucket === t)).length;
  const href = (t: Tab, k: InboxKind | null) => {
    const p = new URLSearchParams();
    if (t !== "mine") p.set("tab", t);
    if (k) p.set("kind", k);
    if (tenant !== "default") p.set("tenant", tenant);
    const s = p.toString();
    return `/dashboard/inbox${s ? `?${s}` : ""}`;
  };
  const hint = TABS.find((t) => t.key === tab)!.hint;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title="Inbox" subtitle="What is waiting on you, across your workspaces. An item leaves on its own when it is done where it lives — a gate decided, an issue resolved, a fix applied." />
      <nav className="mb-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={href(t.key, kind)} className={`rounded-md px-3 py-1.5 ${t.key === tab ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-sunken hover:text-fg"}`}>
            {t.label} <span className="tabular-nums text-fg-subtle">{count(t.key)}</span>
          </Link>
        ))}
      </nav>
      <p className="mb-3 text-xs text-fg-muted">{hint}</p>
      <nav className="mb-4 flex flex-wrap gap-1 text-xs">
        <Link href={href(tab, null)} className={`rounded-full px-2.5 py-1 ${!kind ? "bg-fg text-paper" : "bg-sunken text-fg-muted hover:text-fg"}`}>All</Link>
        {KINDS.map((k) => (
          <Link key={k.key} href={href(tab, k.key)} className={`rounded-full px-2.5 py-1 ${kind === k.key ? "bg-fg text-paper" : "bg-sunken text-fg-muted hover:text-fg"}`}>
            {k.label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          {tab === "dismissed" ? "Nothing set aside." : "Nothing waiting here."}
        </p>
      ) : (
        <InboxList items={items} tenant={tenant} dismissedView={tab === "dismissed"} />
      )}
    </main>
  );
}
