// The billing section's one navigation: Balance, Plan, Usage, Statement,
// Invoices, Payment, Details, Limits. Wallet and Usage used to be two unrelated
// entries behind the avatar; a customer's money is one subject and every
// serious SaaS treats it as one section with tabs.

import { $t, localized } from "@/i18n";
import { PageTabs } from "@foldrun/ui/react/page-tabs";

export const BILLING_TABS = localized(() => ([
  { key: "balance", name: $t("components.billing-tabs.balance"), href: "/dashboard/billing" },
  { key: "plans", name: $t("components.billing-tabs.plan"), href: "/dashboard/billing/plans" },
  { key: "usage", name: $t("components.billing-tabs.usage"), href: "/dashboard/usage" },
  { key: "statement", name: $t("components.billing-tabs.statement"), href: "/dashboard/billing/statement" },
  { key: "invoices", name: $t("components.billing-tabs.invoices"), href: "/dashboard/billing/invoices" },
  { key: "payment", name: $t("components.billing-tabs.payment"), href: "/dashboard/billing/payment" },
  { key: "details", name: $t("components.billing-tabs.details"), href: "/dashboard/billing/details" },
  { key: "limits", name: $t("components.billing-tabs.spendLimits"), href: "/dashboard/limits" },
] as const));

export type BillingTab = (typeof BILLING_TABS)[number]["key"];

/** The billing section's tabs, drawn by the kit's PageTabs. */
export function BillingTabs({ current, tenant, hosted }: { current: BillingTab; tenant: string; hosted: boolean }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  // Without billing there is no wallet, plan or invoice: what is left is
  // the engine's — usage and spend limits.
  const tabs = hosted ? BILLING_TABS : BILLING_TABS.filter((t) => t.key === "usage" || t.key === "limits");
  if (tabs.length < 2) return null;
  return <PageTabs label={$t("components.billing-tabs.billing")} tabs={tabs.map((t) => ({ label: t.name, href: `${t.href}${qs}`, active: t.key === current }))} />;
}
