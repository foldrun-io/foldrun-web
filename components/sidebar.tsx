"use client";

// App sidebar. A **workspace** is the unit you work in — it owns its agents,
// flows, skills, memory, tools, scripts and runs. The switcher at the top
// moves between them; every nav item below is scoped to the current one.
//
// The account (set by your API key) sits above workspaces and is deliberately
// invisible here: it decides which workspaces you can see, nothing more.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useSyncExternalStore } from "react";
import { FindTrigger } from "./find";
import { useHosted } from "./edition";
import { VersionFooter } from "./version";

/** Path segments directly under /dashboard that are account-level, not a workspace. */
const ACCOUNT_SEGMENTS = new Set(["", "runs", "storage", "settings", "profile", "library", "graph", "observe", "issues", "inbox", "usage", "wallet", "billing", "help", "docs", "whats-new", "connect", "limits"]);

/** The workspace a dashboard path is inside, or null on an account page. */
export function workspaceOf(pathname: string): string | null {
  const segment = pathname.split("/")[2] ?? "";
  return segment && !ACCOUNT_SEGMENTS.has(segment) ? segment : null;
}

const ICONS = {
  overview: <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" />,
  agents: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="3" />
      <path d="M12 8V4M8 14h.01M16 14h.01" />
    </>
  ),
  flows: (
    <>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4M12 11H5v5M12 11h7v5" />
    </>
  ),
  graph: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 7.5 10.5 16M17 7.5 13.5 16" />
    </>
  ),
  runs: <polygon points="6 3 20 12 6 21 6 3" />,
  observe: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  issues: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  triggers: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
  checks: <><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  state: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  hooks: <><path d="M12 3v9a4 4 0 1 1-8 0" /><path d="M12 3l3 3" /></>,
  evals: (
    <>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  skills: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m13 2-3 7h5l-3 7" />
    </>
  ),
  memory: <path d="M12 2a5 5 0 0 0-5 5v1a4 4 0 0 0 0 8v1a5 5 0 0 0 10 0v-1a4 4 0 0 0 0-8V7a5 5 0 0 0-5-5Z" />,
  knowledge: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  tools: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />,
  scripts: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  files: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </>
  ),
  source: (
    <>
      <path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="m10 11-2 2 2 2M14 11l2 2-2 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
} as const;

function Icon({ d }: { d: keyof typeof ICONS }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[d]}
    </svg>
  );
}

// Collapsed or not is a preference of this browser, read as an external
// store so the server paints it open, the first client paint agrees, and
// the remembered choice arrives without an effect.
const RAIL_KEY = "foldrun:sidebar-collapsed";
const RAIL_EVENT = "foldrun:sidebar-collapsed";
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeCollapsed(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(RAIL_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(RAIL_EVENT, cb);
  };
}
function setCollapsed(v: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(RAIL_EVENT));
}

export function Sidebar({ variant = "desktop" }: { variant?: "desktop" | "drawer" } = {}) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false) && variant === "desktop";
  const pathname = usePathname();
  const hosted = useHosted();
  const params = useSearchParams();
  const account = params.get("tenant") ?? "default";
  const kind = params.get("kind");
  const accountQuery = account !== "default" ? `&tenant=${account}` : "";
  const accountFirst = account !== "default" ? `?tenant=${account}` : "";

  // The workspace is the first path segment under /dashboard — unless it's one
  // of the account-level pages. Declared once: this list said "shared" after
  // that route became "library", so /dashboard/library rendered a full
  // workspace nav for a workspace named "library" that doesn't exist.
  const workspace = workspaceOf(pathname);

  const nav = workspace
    ? ([
        { group: "", name: "Overview", href: `/dashboard/${workspace}${accountFirst}`, icon: "overview", on: pathname === `/dashboard/${workspace}` },

        // Grouped by the question each door answers rather than by the order
        // the file tree happens to show: what you build, what agents can do,
        // what they know, and views over the whole thing. Seven nouns listed
        // flat read as seven decisions you owe an answer to; the headings say
        // most of them are not decisions at all. Group order here is the
        // render order — the heading appears where the group changes.
        { group: "Build", name: "Agents", href: `/dashboard/${workspace}/agents${accountFirst}`, icon: "agents", on: pathname.endsWith("/agents") },
        { group: "Build", name: "Evals", href: `/dashboard/${workspace}/evals${accountFirst}`, icon: "evals", on: pathname.endsWith("/evals") },
        { group: "Build", name: "Flows", href: `/dashboard/${workspace}/flows${accountFirst}`, icon: "flows", on: pathname.endsWith("/flows") },
        // One shelf for capability. A script tool now carries its own code
        // inside its folder, so there is no second shelf to keep in sync —
        // and no way to point a definition at the wrong scope. The scripts/
        // directory still exists and still works; it just isn't a decision
        // anyone has to make when giving an agent an ability.
        { group: "Do", name: "Tools", href: `/dashboard/${workspace}/assets?kind=tools${accountQuery}`, icon: "tools", on: pathname.endsWith("/assets") && kind === "tools" },
        // Hooks sit right after tools, as in KINDS: a tool is a call an agent
        // may make, a hook is your code at the moment it makes one. The page
        // also lists what the hooks denied or rewrote in recent runs.
        { group: "Do", name: "Hooks", href: `/dashboard/${workspace}/assets?kind=hooks${accountQuery}`, icon: "hooks", on: pathname.endsWith("/assets") && kind === "hooks" },

        { group: "Know", name: "Knowledge", href: `/dashboard/${workspace}/edit?scope=knowledge${accountQuery}`, icon: "knowledge", on: (pathname.endsWith("/edit") && params.get("scope") === "knowledge") || (pathname.endsWith("/assets") && kind === "knowledge") },
        { group: "Know", name: "Memory", href: `/dashboard/${workspace}/edit?scope=memory${accountQuery}`, icon: "memory", on: (pathname.endsWith("/edit") && params.get("scope") === "memory") || (pathname.endsWith("/assets") && kind === "memory") },
        { group: "Know", name: "Skills", href: `/dashboard/${workspace}/edit?scope=skills${accountQuery}`, icon: "skills", on: (pathname.endsWith("/edit") && params.get("scope") === "skills") || (pathname.endsWith("/assets") && kind === "skills") },
        // Knowledge, Memory and Skills open as files too (owner, 11 Oct 2026):
        // the markdown an account is made of is browsed as a file system, the
        // way State always was; their cards page is one link from the tree.
        // State holds data, not documents — no name, no description, nothing
        // for an asset row to render — so it never had a listing page.
        //
        // `?scope=` rather than `?path=`: the editor narrows its tree to that
        // directory and titles the page after it. With `?path=state` the tree
        // still showed the entire workspace, so this item and Source below
        // led to visibly identical pages and nothing said which was which.
        { group: "Know", name: "State", href: `/dashboard/${workspace}/edit?scope=state${accountQuery}`, icon: "state", on: pathname.endsWith("/edit") && params.get("scope") === "state" },

        // Views over the workspace, rather than parts of it.
        //
        // Files and Source are two different things and the labels have to
        // say so. Files is the markdown you write and diff — what a deploy
        // carries. Storage is the byte store: uploads and whatever agents
        // produce, which a deploy never carries and the file tree never
        // shows. "Storage" rather than "Files" for the bytes because in this
        // product everything is a file — agents are folders — so the generic
        // word cannot be the one that distinguishes. "Storage" is also true
        // of both drivers; "Bucket" would only describe the hosted one and
        // would lie to anyone running the local fs driver. The code and SPEC
        // keep saying "source" where it means "what a deploy carries": that
        // is our vocabulary, and this is the reader's.
        { group: "View", name: "Files", href: `/dashboard/${workspace}/edit${accountFirst}`, icon: "source", on: pathname.endsWith("/edit") && !params.get("scope") },
        { group: "View", name: "Storage", href: `/dashboard/${workspace}/storage${accountFirst}`, icon: "files", on: pathname.endsWith("/storage") },
        { group: "View", name: "Graph", href: `/dashboard/${workspace}/graph${accountFirst}`, icon: "graph", on: pathname.endsWith("/graph") },
        { group: "View", name: "Runs", href: `/dashboard/${workspace}/runs${accountFirst}`, icon: "runs", on: pathname.endsWith("/runs") },
        { group: "View", name: "Observe", href: `/dashboard/${workspace}/observe${accountFirst}`, icon: "observe", on: pathname.endsWith("/observe") },
        // Runs that never happened. Beside Observe because it answers the
        // other half of "something is wrong": Observe reads the runs there
        // are, this reads the ones there are not.
        { group: "View", name: "Triggers", href: `/dashboard/${workspace}/triggers${accountFirst}`, icon: "triggers", on: pathname.endsWith("/triggers") },
        // What check says about the deployed copy — the deploy's rules and
        // the security scanner — beside the other "is something wrong" views.
        { group: "View", name: "Checks", href: `/dashboard/${workspace}/checks${accountFirst}`, icon: "checks", on: pathname.endsWith("/checks") },
        { group: "View", name: "History", href: `/dashboard/${workspace}/history${accountFirst}`, icon: "history", on: pathname.endsWith("/history") },
        { group: "View", name: "Settings", href: `/dashboard/${workspace}/settings${accountFirst}`, icon: "settings", on: pathname === `/dashboard/${workspace}/settings` },
      ] as const)
    : // Inside the account drawer's pages, the top nav is the shared library
      // — the same nouns a workspace uses, minus workspace-only State. The
      // cross-cutting pages (workspaces, runs, settings) live in the pinned
      // Account section below, same as they do when a workspace is open.
      ([
        // The same nouns a workspace uses, at the account's scope. There is no
        // separate "library" system to learn: account-level Tools *are* the
        // shared tools, account-level Skills *are* the shared skills. The old
        // heading said "Library", which made one shelf look like a second
        // product with its own concepts. "Shared" says what it does.
        { group: "Shared", name: "Tools", href: `/dashboard/library?kind=tools${accountQuery}`, icon: "tools", on: pathname === "/dashboard/library" && kind === "tools" },
        { group: "Shared", name: "Hooks", href: `/dashboard/library?kind=hooks${accountQuery}`, icon: "hooks", on: pathname === "/dashboard/library" && kind === "hooks" },
        { group: "Shared", name: "Knowledge", href: `/dashboard/library?kind=knowledge${accountQuery}`, icon: "knowledge", on: pathname === "/dashboard/library" && kind === "knowledge" },
        { group: "Shared", name: "Memory", href: `/dashboard/library?kind=memory${accountQuery}`, icon: "memory", on: pathname === "/dashboard/library" && kind === "memory" },
        { group: "Shared", name: "Skills", href: `/dashboard/library?kind=skills${accountQuery}`, icon: "skills", on: pathname === "/dashboard/library" && kind === "skills" },
        { group: "View", name: "Files", href: `/dashboard/library/files${accountFirst}`, icon: "source", on: pathname === "/dashboard/library/files" },
        { group: "View", name: "Storage", href: `/dashboard/storage${accountFirst}`, icon: "files", on: pathname === "/dashboard/storage" },
        { group: "View", name: "Graph", href: `/dashboard/graph${accountFirst}`, icon: "graph", on: pathname === "/dashboard/graph" },
        { group: "View", name: "Runs", href: `/dashboard/runs${accountFirst}`, icon: "runs", on: pathname === "/dashboard/runs" },
        { group: "View", name: "Inbox", href: `/dashboard/inbox${accountFirst}`, icon: "inbox", on: pathname === "/dashboard/inbox" },
        { group: "View", name: "Issues", href: `/dashboard/issues${accountFirst}`, icon: "issues", on: pathname === "/dashboard/issues" },
        { group: "View", name: "Observe", href: `/dashboard/observe${accountFirst}`, icon: "observe", on: pathname === "/dashboard/observe" },
      ] as const);

  // No pinned account section down here any more: the person-and-money pages
  // (account, usage, wallet, help, settings) live behind the avatar, top
  // right — the sidebar is about the workspace you are in, nothing else.

  return (
    <aside
      className={
        variant === "drawer"
          ? "flex h-full w-64 flex-col overflow-y-auto border-r border-line bg-paper-deep px-3 py-4"
          : `sticky top-0 flex h-screen ${collapsed ? "w-14 px-2" : "w-56 px-3"} shrink-0 flex-col overflow-y-auto border-r border-line bg-paper-deep py-4 max-md:hidden`
      }
    >
      <Link href="/" className={`mb-4 flex items-center gap-2 ${collapsed ? "justify-center px-0" : "px-2"}`} aria-label="foldrun" title="foldrun">
        {/* A folder, because that is what an agent is here. */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg" aria-hidden>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          <path d="M3 11h18" />
          {/* The run light. The ring is the surface behind it, so the dot never
              touches the folder's outline at any size. */}
          <circle cx="20.6" cy="19.4" r="3" fill="var(--color-paper-deep)" stroke="none" />
          <circle cx="20.6" cy="19.4" r="1.9" fill="#10b981" stroke="none" />
        </svg>
        {!collapsed && <span className="font-cal text-base tracking-tight text-fg">foldrun</span>}
      </Link>

      {/* Find, at the top: F or ⌘K from anywhere, or a click here. The
          workspace switcher that stood here moved to the top bar, beside
          the account. */}
      <FindTrigger compact={collapsed} />

      <nav className="flex flex-col gap-0.5">
        {nav.map((item, i) => (
          <Fragment key={item.name}>
            {/* A heading where the group changes. Seven doors listed flat read
                as seven decisions; three headings say what each door is for —
                what you build, what agents can do, what they know. The empty
                group is Overview, which is not a category. */}
            {item.group && item.group !== nav[i - 1]?.group && (
              collapsed ? (
                <span className="mx-2 my-2 block border-t border-line" aria-hidden />
              ) : (
                <p className="mt-3 px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {item.group}
                </p>
              )
            )}
          <Link
            href={item.href}
            title={collapsed ? item.name : undefined}
            aria-label={item.name}
            className={`flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium transition-colors ${collapsed ? "justify-center px-0" : "px-2"} ${
              item.on ? "bg-accent-soft text-accent" : "text-fg-tertiary hover:bg-muted-strong/40 hover:text-fg"
            }`}
          >
            <span className={item.on ? "text-accent" : "text-fg-muted"}>
              <Icon d={item.icon} />
            </span>
            {!collapsed && item.name}
          </Link>
          </Fragment>
        ))}
      </nav>

      {/* The account's money, pinned at the foot on hosted installs. The
          person-and-account pages still live behind the avatar; billing is
          the one that earns a permanent door, because a balance is the one
          fact about an account that should never be more than a click away. */}
      {hosted && (
        <div className="mt-4 border-t border-line pt-3">
          {!collapsed && <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Account</p>}
          <Link
            href={`/dashboard/billing${accountFirst}`}
            aria-current={pathname.startsWith("/dashboard/billing") || pathname === "/dashboard/usage" ? "page" : undefined}
            title="Billing"
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname.startsWith("/dashboard/billing") || pathname === "/dashboard/usage" ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-tertiary hover:bg-surface/60 hover:text-fg"
            } ${collapsed ? "justify-center" : ""}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" />
            </svg>
            {!collapsed && <span>Billing</span>}
          </Link>
        </div>
      )}

      {/* The rail toggle, at the foot: the same sidebar as a strip of icons
          for anyone who wants the width back. Not in the drawer, which is
          already the narrow case. */}
      {variant === "desktop" && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          className={`mt-auto flex items-center gap-2 rounded-md py-1.5 text-xs text-fg-subtle hover:bg-muted-strong/40 hover:text-fg-secondary ${collapsed ? "justify-center px-0" : "px-2"}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
          </svg>
          {!collapsed && "Collapse"}
        </button>
      )}
      {/* The version, smallest thing on the page, linking to what changed.
          The drawer has no Collapse button to push it down, so it does. */}
      <div className={variant === "drawer" ? "mt-auto" : ""}>
        <VersionFooter collapsed={collapsed} query={accountFirst} />
      </div>
    </aside>
  );
}
