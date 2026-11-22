// The dashboard's navigation, as data (UI refactor, Nov 2026). The sidebar,
// the bar's title, the phone menu and the tests all read this one place.
//
// The shape is cloudhost's (Vercel's): on an account page the sidebar lists
// the account's doors; inside a workspace it becomes that workspace's own
// list, with a way back to all workspaces at the top — the way a cloudhost
// project page puts the project's sections in the sidebar. Sections are
// separated by a hairline, not headed: the doors say what they are.
// Every existing URL is kept; doors that merged (Files: the editor and its
// knowledge/memory/skills/state scopes; Tools & hooks) carry tabs that link
// to the same URLs as before.

import { $t } from "@/i18n";
import { kindsAt } from "@/lib/kinds";

/** Path segments directly under /dashboard that are account-level, not a workspace. */
export const ACCOUNT_SEGMENTS = new Set(["", "runs", "storage", "settings", "profile", "library", "graph", "observe", "issues", "inbox", "usage", "wallet", "billing", "help", "docs", "whats-new", "connect", "limits", "welcome"]);

/** The workspace a dashboard path is inside, or null on an account page. */
export function workspaceOf(pathname: string): string | null {
  const segment = pathname.split("/")[2] ?? "";
  return segment && !ACCOUNT_SEGMENTS.has(segment) ? segment : null;
}

export type NavIcon =
  | "overview" | "runs" | "observe" | "flows" | "agents" | "evals" | "triggers" | "files" | "tools" | "storage"
  | "checks" | "graph" | "history" | "settings" | "workspaces" | "inbox" | "issues" | "library" | "usage" | "billing";

export type NavItem = {
  name: string;
  href: string;
  icon: NavIcon;
  on: boolean;
  /** It has pages under it: a chevron on the end. */
  more?: boolean;
  /** A count in a small amber pill. */
  badge?: number;
};
export type NavSection = { items: NavItem[] };
export type Nav = {
  /** Inside a workspace: the way back to every workspace. */
  back?: { label: string; href: string };
  sections: NavSection[];
  /** The door this page belongs to — the bar's title. */
  current?: NavItem;
};

/** The nouns an agent reads and uses, in the one order every surface lists
 *  them (the library, the asset pages, the tabs): the kinds table's own,
 *  less scripts — a script tool carries its code in its folder, so code is
 *  material a tool holds, not a shelf anyone picks from. */
export const NOUN_ORDER = kindsAt("account").filter((k) => k !== "scripts");

const withCurrent = (nav: Omit<Nav, "current">): Nav => ({ ...nav, current: nav.sections.flatMap((s) => s.items).find((i) => i.on) });

export function workspaceNav(workspace: string, pathname: string, params: URLSearchParams, tenant: string): Nav {
  const first = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}`;
  const kind = params.get("kind");
  const at = (p: string) => pathname === `${base}${p}` || pathname.startsWith(`${base}${p}/`);
  const filesOn = pathname === `${base}/edit` || (at("/assets") && (kind === "knowledge" || kind === "memory" || kind === "skills"));
  const toolsOn = at("/assets") && (kind === "tools" || kind === "hooks" || !kind);
  return withCurrent({
    back: { label: $t("components.nav-model.allWorkspace"), href: `/dashboard${first}` },
    sections: [
      {
        items: [
          { name: $t("components.nav-model.overview"), href: `${base}${first}`, icon: "overview", on: pathname === base },
          { name: $t("components.nav-model.runs"), href: `${base}/runs${first}`, icon: "runs", on: at("/runs") },
          { name: $t("components.nav-model.observe"), href: `${base}/observe${first}`, icon: "observe", on: at("/observe") },
        ],
      },
      {
        items: [
          { name: $t("components.nav-model.flows"), href: `${base}/flows${first}`, icon: "flows", on: at("/flows") },
          { name: $t("components.nav-model.agents"), href: `${base}/agents${first}`, icon: "agents", on: at("/agents") },
          { name: $t("components.nav-model.evals"), href: `${base}/evals${first}`, icon: "evals", on: at("/evals") },
          { name: $t("components.nav-model.triggers"), href: `${base}/triggers${first}`, icon: "triggers", on: at("/triggers") },
        ],
      },
      {
        items: [
          { name: $t("components.nav-model.files"), href: `${base}/edit${first}`, icon: "files", on: filesOn, more: true },
          { name: $t("components.nav-model.toolsHooks"), href: `${base}/assets?kind=tools${amp}`, icon: "tools", on: toolsOn },
          { name: $t("components.nav-model.storage"), href: `${base}/storage${first}`, icon: "storage", on: at("/storage") },
        ],
      },
      {
        items: [
          { name: $t("components.nav-model.checks"), href: `${base}/checks${first}`, icon: "checks", on: at("/checks") },
          { name: $t("components.nav-model.graph"), href: `${base}/graph${first}`, icon: "graph", on: at("/graph") },
          { name: $t("components.nav-model.history"), href: `${base}/history${first}`, icon: "history", on: at("/history") },
          { name: $t("components.nav-model.settings"), href: `${base}/settings${first}`, icon: "settings", on: at("/settings") },
        ],
      },
    ],
  });
}

export function accountNav(pathname: string, tenant: string, counts: { inbox?: number } = {}): Nav {
  const first = tenant !== "default" ? `?tenant=${tenant}` : "";
  const amp = tenant !== "default" ? `&tenant=${tenant}` : "";
  const at = (p: string) => pathname === `/dashboard${p}` || pathname.startsWith(`/dashboard${p}/`);
  return withCurrent({
    sections: [
      {
        items: [
          { name: $t("components.nav-model.workspace"), href: `/dashboard${first}`, icon: "workspaces", on: pathname === "/dashboard" },
          { name: $t("components.nav-model.runs"), href: `/dashboard/runs${first}`, icon: "runs", on: at("/runs") },
          { name: $t("components.nav-model.inbox"), href: `/dashboard/inbox${first}`, icon: "inbox", on: at("/inbox"), badge: counts.inbox || undefined },
          { name: $t("components.nav-model.issues"), href: `/dashboard/issues${first}`, icon: "issues", on: at("/issues") },
          { name: $t("components.nav-model.observe"), href: `/dashboard/observe${first}`, icon: "observe", on: at("/observe") },
        ],
      },
      {
        items: [
          { name: $t("components.nav-model.library"), href: `/dashboard/library?kind=tools${amp}`, icon: "library", on: at("/library"), more: true },
          { name: $t("components.nav-model.storage"), href: `/dashboard/storage${first}`, icon: "storage", on: at("/storage") },
          { name: $t("components.nav-model.graph"), href: `/dashboard/graph${first}`, icon: "graph", on: at("/graph") },
        ],
      },
      // Billing and Settings are the account's, and live in the user menu
      // only (owner, 8 Nov 2026, FOL-150): the sidebar listed the same two
      // pages a second time. Their bar titles come from pageTitle below.
      {
        items: [
          { name: $t("components.nav-model.usage"), href: `/dashboard/usage${first}`, icon: "usage", on: at("/usage") || at("/limits") },
        ],
      },
    ],
  });
}

/** Pages that are not in the sidebar but have a name for the bar. */
export function pageTitle(pathname: string): string | null {
  const seg = pathname.split("/")[2] ?? "";
  return (
    ({ docs: $t("components.nav-model.docs"), help: $t("components.nav-model.help"), welcome: $t("components.nav-model.getStarted"), "whats-new": $t("components.nav-model.whatSNew"), profile: $t("components.nav-model.profile"), connect: $t("components.nav-model.connect"), wallet: $t("components.nav-model.wallet"), limits: $t("components.nav-model.limits"), billing: $t("components.nav-model.billing"), settings: $t("components.nav-model.settings") } as Record<string, string>)[seg] ?? null
  );
}

/** The tabs of the merged Files door, in noun order, then the whole tree. */
export function filesTabs(workspace: string, tenant: string) {
  const t = tenant !== "default" ? `&tenant=${tenant}` : "";
  const first = tenant !== "default" ? `?tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}/edit`;
  return [
    { label: $t("components.nav-model.allFiles"), href: `${base}${first}` },
    { label: $t("components.nav-model.knowledge"), href: `${base}?scope=knowledge${t}` },
    { label: $t("components.nav-model.memory"), href: `${base}?scope=memory${t}` },
    { label: $t("components.nav-model.skills"), href: `${base}?scope=skills${t}` },
    { label: $t("components.nav-model.state"), href: `${base}?scope=state${t}` },
  ];
}

/** The tabs of the Tools & hooks door. */
export function toolsTabs(workspace: string, tenant: string) {
  const t = tenant !== "default" ? `&tenant=${tenant}` : "";
  const base = `/dashboard/${workspace}/assets`;
  return [
    { label: $t("components.nav-model.tools"), href: `${base}?kind=tools${t}` },
    { label: $t("components.nav-model.hooks"), href: `${base}?kind=hooks${t}` },
  ];
}

/** The tabs of the account's shared Library, in noun order, then its files. */
export function libraryTabs(tenant: string) {
  const t = tenant !== "default" ? `&tenant=${tenant}` : "";
  const first = tenant !== "default" ? `?tenant=${tenant}` : "";
  return [
    ...NOUN_ORDER.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), href: `/dashboard/library?kind=${k}${t}` })),
    { label: $t("components.nav-model.files"), href: `/dashboard/library/files${first}` },
  ];
}
