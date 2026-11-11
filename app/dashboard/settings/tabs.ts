// The account's Settings as tabs (UI refactor, Nov 2026). The page used to be
// one long column with a section list beside it, and links pointed into it
// by anchor — `/dashboard/settings#provider`. Each anchor now lives on one
// tab; `settingsHref("provider")` is the link to it, and SettingsAnchor sends
// an old `#provider` link (in a sent email, say) to its tab.
import type { PageTab } from "@foldrun/ui/react/page-tabs";

export type SettingsTab = "general" | "team" | "policies" | "models" | "api" | "secrets" | "schedules" | "security";

/** Which tab each old section anchor is on. */
export const SECTION_TAB: Record<string, SettingsTab | "backups" | "audit"> = {
  account: "general",
  defaults: "general",
  timezone: "general",
  about: "general",
  flags: "general",
  data: "general",
  close: "general",
  team: "team",
  governance: "policies",
  guardrail: "policies",
  observability: "policies",
  evaluation: "policies",
  "agents-md": "policies",
  pause: "policies",
  provider: "models",
  "model-key": "models",
  "api-keys": "api",
  mcp: "api",
  "mcp-connections": "api",
  api: "api",
  customers: "api",
  secrets: "secrets",
  webhooks: "secrets",
  schedules: "schedules",
  security: "security",
  backups: "backups",
  audit: "audit",
};

const ROUTE: Record<"backups" | "audit", string> = {
  backups: "/dashboard/settings/backups",
  audit: "/dashboard/settings/audit",
};

/** The link to a section of the account's Settings: its tab, then its anchor. */
export function settingsHref(section: string, tenant = "default"): string {
  const tab = SECTION_TAB[section];
  const t = tenant !== "default" ? `tenant=${encodeURIComponent(tenant)}` : "";
  if (tab === "backups" || tab === "audit") return `${ROUTE[tab]}${t ? `?${t}` : ""}`;
  const q = [t, tab && tab !== "general" ? `tab=${tab}` : ""].filter(Boolean).join("&");
  return `/dashboard/settings${q ? `?${q}` : ""}${tab ? `#${section}` : ""}`;
}

/** The tabs over every account Settings page. `active` names the current one. */
export function settingsTabs(tenant: string, opts: { team: boolean; active: SettingsTab | "backups" | "audit" }): PageTab[] {
  const t = tenant !== "default" ? `tenant=${encodeURIComponent(tenant)}` : "";
  const tab = (key: SettingsTab, label: string): PageTab => {
    const q = [t, key !== "general" ? `tab=${key}` : ""].filter(Boolean).join("&");
    return { label, href: `/dashboard/settings${q ? `?${q}` : ""}`, active: opts.active === key };
  };
  return [
    tab("general", "General"),
    ...(opts.team ? [tab("team", "Team")] : []),
    tab("policies", "Policies"),
    tab("models", "Models"),
    tab("api", "API keys"),
    tab("secrets", "Secrets"),
    tab("schedules", "Schedules"),
    tab("security", "Security"),
    { label: "Audit log", href: `${ROUTE.audit}${t ? `?${t}` : ""}`, active: opts.active === "audit" },
    { label: "Backups", href: `${ROUTE.backups}${t ? `?${t}` : ""}`, active: opts.active === "backups" },
  ];
}

export const SETTINGS_TABS: SettingsTab[] = ["general", "team", "policies", "models", "api", "secrets", "schedules", "security"];
