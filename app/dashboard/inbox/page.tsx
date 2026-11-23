// Your inbox: everything waiting on you across your workspaces, in one list
// (server/inbox.ts — the same as GET /v1/me/inbox and `foldrun inbox`).
// Three tabs that never mix: assigned to you, runs you started, and the rest
// of what waits in your workspaces; a fourth for what you set aside.

import { $t } from "@/i18n";
import { Inbox as InboxIcon, LogIn } from "lucide-react";
import { Page, PageHeader, EmptyState } from "@foldrun/ui/react/page";
import { PageTabs } from "@foldrun/ui/react/page-tabs";
import { Segmented } from "@foldrun/ui/react/segmented";
import { viewerEmail, viewerRole, viewerScope } from "@/server/users";
import { inboxFor, type InboxItem, type InboxKind } from "@/server/inbox";
import { InboxList } from "@/components/inbox-list";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "mine", label: $t("inbox.page.forMe"), hint: $t("inbox.page.youAreNamedAsAnApprover") },
  { key: "started", label: $t("inbox.page.startedByMe"), hint: $t("inbox.page.runsYouStartedAFailureOr") },
  { key: "team", label: $t("inbox.page.team"), hint: $t("inbox.page.everythingElseWaitingInYourWorkspace") },
  { key: "dismissed", label: $t("inbox.page.setAside"), hint: $t("inbox.page.whatYouHidFromYourView") },
] as const;
type Tab = (typeof TABS)[number]["key"];

const KINDS: { key: InboxKind; label: string }[] = [
  { key: "approval", label: $t("inbox.page.approvals") },
  { key: "question", label: $t("inbox.page.questions") },
  { key: "issue", label: $t("inbox.page.issues") },
  { key: "proposal", label: $t("inbox.page.proposedFixes") },
  { key: "run", label: $t("inbox.page.yourRuns") },
];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tenant?: string; tab?: string; kind?: string }> }) {
  const { tenant = "default", tab: tabParam, kind: kindParam } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "mine";
  const kind = KINDS.some((k) => k.key === kindParam) ? (kindParam as InboxKind) : null;
  const person = await viewerEmail();

  if (!person) {
    return (
      <Page>
        <PageHeader title={$t("inbox.page.inbox")} description={$t("inbox.page.whatIsWaitingOnYouAcross")} />
        <EmptyState icon={<LogIn />} title={$t("inbox.page.signInToSeeYourInbox")} description={$t("inbox.page.anInboxIsAPersonS")} />
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
      <PageHeader title={$t("inbox.page.inbox")} description={$t("inbox.page.whatIsWaitingOnYouAcross2")} />
      <PageTabs tabs={TABS.map((t) => ({ label: t.label, href: href(t.key, kind), badge: count(t.key), active: t.key === tab }))} className="mb-4" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Segmented
          label={$t("inbox.page.kind")}
          value={kind ?? "all"}
          items={[{ key: "all", label: $t("inbox.page.all"), href: href(tab, null) }, ...KINDS.map((k) => ({ key: k.key, label: k.label, href: href(tab, k.key) }))]}
        />
        <p className="text-[13px] text-fg-muted">{hint}</p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<InboxIcon />} title={tab === "dismissed" ? $t("inbox.page.nothingSetAside") : $t("inbox.page.nothingWaitingHere")} description={tab === "dismissed" ? undefined : $t("inbox.page.youAreAllCaughtUp")} />
      ) : (
        <InboxList items={items} tenant={tenant} dismissedView={tab === "dismissed"} />
      )}
    </Page>
  );
}
