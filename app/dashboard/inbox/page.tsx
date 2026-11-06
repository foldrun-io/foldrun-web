// Your inbox: everything waiting on you across your workspaces, in one list
// (server/inbox.ts — the same as GET /api/me/inbox and `foldrun inbox`).
// Three tabs that never mix: assigned to you, runs you started, and the rest
// of what waits in your workspaces; a fourth for what you set aside.

import { Inbox as InboxIcon, LogIn } from "lucide-react";
import { Page, PageHeader, EmptyState } from "@/components/kit/page";
import { PageTabs } from "@/components/kit/page-tabs";
import { Segmented } from "@/components/kit/inspect-extra";
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
      <Page>
        <PageHeader title="Inbox" description="What is waiting on you, across your workspaces." />
        <EmptyState icon={<LogIn />} title="Sign in to see your inbox" description="An inbox is a person's: what you approve, what you own, what you started. Nobody is signed in here." />
      </Page>
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
    <Page>
      <PageHeader title="Inbox" description="What is waiting on you, across your workspaces. An item leaves on its own once it is done where it lives." />
      <PageTabs tabs={TABS.map((t) => ({ label: t.label, href: href(t.key, kind), badge: count(t.key), active: t.key === tab }))} className="mb-4" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Segmented
          label="Kind"
          value={kind ?? "all"}
          items={[{ key: "all", label: "All", href: href(tab, null) }, ...KINDS.map((k) => ({ key: k.key, label: k.label, href: href(tab, k.key) }))]}
        />
        <p className="text-[13px] text-fg-muted">{hint}</p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<InboxIcon />} title={tab === "dismissed" ? "Nothing set aside" : "Nothing waiting here"} description={tab === "dismissed" ? undefined : "You are all caught up."} />
      ) : (
        <InboxList items={items} tenant={tenant} dismissedView={tab === "dismissed"} />
      )}
    </Page>
  );
}
