import fs from "node:fs";
import path from "node:path";

// Billing's own part of the web app: the customer billing pages and routes,
// the operator console, Stripe. Paths from the repo root; a trailing slash
// is a folder. Read by tests/billing-boundary.test.ts (nothing else may
// import these) and scripts/without-billing.mjs (the build without them).

/** Billing's own part of the web app: the customer billing pages and
 *  routes, the operator console, Stripe. Paths from the repo root. */
export const BILLING_FILES = [
  "app/admin/",
  "app/api/admin/",
  "app/api/billing/",
  "app/dashboard/billing/",
  "app/dashboard/wallet/",
  "server/admin/",
  "server/stripe.ts",
  "server/stripe-webhook.ts",
  "components/billing-details-form.tsx",
  "components/admin-act.ts",
  "components/low-balance-banner.tsx",
  "components/balance-pill.tsx",
  "components/dunning-banner.tsx",
  "components/manage-in-stripe.tsx",
];

/** components/billing-slots.tsx as the public repository has it: renders
 *  nothing. The hosted build lays foldrun-admin's real one over it. */
export const SLOTS_STUB = `"use client";

// The dashboard's billing chrome — the balance pill and the low-balance and
// payment-overdue banners — is foldrun's hosted business (foldrun-admin).
// Without it there is nothing to show. The hosted build replaces this file
// with the real components (foldrun-admin overlay.sh).

export function BalancePill(_: { tenant: string }) {
  return null;
}

export function LowBalanceBanner(_: { tenant: string }) {
  return null;
}

export function DunningBanner(_: { tenant: string }) {
  return null;
}
`;

/** server/billing-notices.ts as the public repository has it: says nothing. */
export const NOTICES_STUB = `// What the dashboard says about money: the balance shown on the home page and
// its alert, and the onboarding list's payment step. That is foldrun's hosted
// business (foldrun-admin); without it there is nothing to say. The hosted
// build replaces this file with the real answers (foldrun-admin overlay.sh).

import type { Alert } from "@/components/overview-model";

/** The balance to show (null when it cannot stop a run) and its alert. */
export async function walletNotice(_tenant: string, _qs: string): Promise<{ balanceUsd: number | null; alert: Alert | null } | null> {
  return null;
}

/** The onboarding list's payment step, or null when there is none. */
export async function paymentStep(_tenant: string): Promise<{ done: boolean } | null> {
  return null;
}
`;

/** Every public file foldrun-admin replaces, with what it must be when
 *  committed here (billing-guard.mjs refuses anything else). */
export const STUBS: Record<string, string> = {
  "components/billing-slots.tsx": SLOTS_STUB,
  "server/billing-notices.ts": NOTICES_STUB,
};

/** Billing's tests in tests/ (foldrun-admin's web/tests). */
export const BILLING_TESTS = [
  "admin-export.test.ts",
  "admin-idempotency-billing.test.ts",
  "admin-idempotency.test.ts",
  "billing-admin.test.ts",
  "billing-checkout.test.ts",
  "stripe-e2e.test.ts",
  "billing-notices-billing.test.ts",
  "consistency-billing.test.ts",
  "flags-routes.test.ts",
  "status-routes.test.ts",
  "stripe.test.ts",
  "support-view.test.ts",
];

const ROOT = path.join(import.meta.dirname, "..");

/** True on a checkout that carries billing (foldrun-admin laid over it),
 *  false on the public one, where none of BILLING_FILES is there. */
export const billingPresent: boolean = BILLING_FILES.every((p) => fs.existsSync(path.join(ROOT, p)));

/** An API operation ("GET /api/billing/plans") or path that is billing's:
 *  the customer billing routes and the operator console's. */
export const isBillingRoute = (op: string): boolean => /(^|\s)\/api\/(billing|admin)(\/|$|\s)/.test(op);
