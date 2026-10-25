// The billing section's one navigation: Balance, Plan, Usage, Statement,
// Invoices, Payment, Details, Limits. Wallet and Usage used to be two unrelated
// entries behind the avatar; a customer's money is one subject and every
// serious SaaS treats it as one section with tabs.

import Link from "next/link";

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

export function BillingTabs({ current, tenant, hosted }: { current: BillingTab; tenant: string; hosted: boolean }) {
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  // Without billing there is no wallet, plan or invoice: what is left is
  // the engine's — usage and spend limits.
  const tabs = hosted ? BILLING_TABS : BILLING_TABS.filter((t) => t.key === "usage" || t.key === "limits");
  if (tabs.length < 2) return null;
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Billing">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${t.href}${qs}`}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
            t.key === current
              ? "border-gray-900 font-medium text-fg"
              : "border-transparent text-fg-muted hover:border-line-strong hover:text-gray-800"
          }`}
        >
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
