// The billing section's one navigation: Balance, Plan, Usage, Statement,
// Invoices, Payment, Details, Limits. Wallet and Usage used to be two unrelated
// entries behind the avatar; a customer's money is one subject and every
// serious SaaS treats it as one section with tabs.

import { PageTabs } from "@/components/kit/page-tabs";

export const BILLING_TABS = [
  { key: "balance", name: "Balance", href: "/dashboard/billing" },
  { key: "plans", name: "Plan", href: "/dashboard/billing/plans" },
  { key: "usage", name: "Usage", href: "/dashboard/usage" },
  { key: "statement", name: "Statement", href: "/dashboard/billing/statement" },
  { key: "invoices", name: "Invoices", href: "/dashboard/billing/invoices" },
  { key: "payment", name: "Payment", href: "/dashboard/billing/payment" },
  { key: "details", name: "Details", href: "/dashboard/billing/details" },
  { key: "limits", name: "Spend limits", href: "/dashboard/limits" },
] as const;

export type BillingTab = (typeof BILLING_TABS)[number]["key"];

/** The billing section's tabs, drawn by the kit's PageTabs. */
export function BillingTabs({ current, tenant, hosted }: { current: BillingTab; tenant: string; hosted: boolean }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  // Without billing there is no wallet, plan or invoice: what is left is
  // the engine's — usage and spend limits.
  const tabs = hosted ? BILLING_TABS : BILLING_TABS.filter((t) => t.key === "usage" || t.key === "limits");
  if (tabs.length < 2) return null;
  return <PageTabs label="Billing" tabs={tabs.map((t) => ({ label: t.name, href: `${t.href}${qs}`, active: t.key === current }))} />;
}
