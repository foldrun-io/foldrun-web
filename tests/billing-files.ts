import fs from "node:fs";
import path from "node:path";

// Billing's own part of the web app: the customer billing pages and routes,
// support's view of an account, the app's side of the operator console's
// internal admin API, Stripe (the console itself is its own application,
// foldrun-admin/console, since 30 Oct 2026). Paths from the repo root; a trailing slash
// is a folder. Read by tests/billing-boundary.test.ts (nothing else may
// import these) and scripts/without-billing.mjs (the build without them).

/** Billing's own part of the web app: the customer billing pages and
 *  routes, support views, the internal admin API, Stripe. Paths from the
 *  repo root. */
export const BILLING_FILES = [
  "app/api/billing/",
  "app/api/support/",
  "app/dashboard/billing/",
  "app/dashboard/wallet/",
  "app/support/",
  "server/admin-api/",
  "server/stripe.ts",
  "server/stripe-webhook.ts",
  "components/billing-details-form.tsx",
  "components/low-balance-banner.tsx",
  "components/balance-pill.tsx",
  "components/dunning-banner.tsx",
  "components/manage-in-stripe.tsx",
  "components/support-banner.tsx",
];

/** components/billing-slots.tsx as the public repository has it: renders
 *  nothing. The hosted build lays foldrun-admin's real one over it. */
export const SLOTS_STUB = `"use client";

// The dashboard's hosted chrome — the balance pill, the low-balance and
// payment-overdue banners, and support's view-as bar — is foldrun's hosted
// business (foldrun-admin). Without it there is nothing to show. The hosted
// build replaces this file with the real components (foldrun-admin
// overlay.sh).

export function BalancePill(_: { tenant: string }) {
  return null;
}

export function LowBalanceBanner(_: { tenant: string }) {
  return null;
}

export function DunningBanner(_: { tenant: string }) {
  return null;
}

export function SupportBanner(_: { account: string; expiresAt: string; reason: string }) {
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

/** server/hosted-services.ts as the public repository has it: nothing
 *  started beside the app (30 Oct 2026). The hosted build's starts the
 *  internal admin API the operator console uses (foldrun-admin). */
const HOSTED_SERVICES_STUB = `// What the hosted app starts beside itself once booted (instrumentation.ts).
//
// foldrun's hosted platform runs services of its own beside the app
// (foldrun-admin); the public edition has none, so as this repository has
// it this starts nothing. The hosted build replaces it (foldrun-admin
// overlay.sh).

export async function startHostedServices(): Promise<void> {}
`;

/** server/view-as.ts as the public repository has it: no support views
 *  (30 Oct 2026 — the view-as rules are foldrun-admin's). */
const VIEW_AS_STUB = `// Support's read-only view of a customer account — the hosted operator
// console's (foldrun-admin), and not part of this repository.
//
// As this repository has it there are no support views: no token resolves
// to one, nothing needs ending at sign-out, and were a session ever marked
// as one, every request would be refused. The hosted build replaces this
// file with the real rules (foldrun-admin overlay.sh); server/users.ts,
// server/auth.ts, server/api.ts, server/api-limits.ts and the sign-out
// route ask it, and nothing else decides.

import type { NextResponse } from "next/server";
import type { UserRecord } from "./users.ts";

/** The live grant a support token names: there are none. */
export async function liveSupportView(_tenant: string, _id: string): Promise<{ id: string; by: string; reason: string; expiresAt: string } | null> {
  return null;
}

/** Why this request is refused under a support view: every one is. */
export function supportViewRefusal(_method: string, _pathname: string): string | null {
  return "support views are not part of this install";
}

/** Sign-out's part for a support view: true when it handled the sign-out
 *  of one (the caller then does nothing else for it). There are none. */
export async function supportSignOut(_session: UserRecord | null, _res: NextResponse): Promise<boolean> {
  return false;
}

/** A write the API's rate limits never refuse, besides signing out: none. */
export function supportExempt(_method: string, _pathname: string): boolean {
  return false;
}
`;

/** Every public file foldrun-admin replaces, with what it must be when
 *  committed here (billing-guard.mjs refuses anything else). */
export const STUBS: Record<string, string> = {
  "components/billing-slots.tsx": SLOTS_STUB,
  "server/billing-notices.ts": NOTICES_STUB,
  "server/hosted-services.ts": HOSTED_SERVICES_STUB,
  "server/view-as.ts": VIEW_AS_STUB,
};

/** Billing's tests in tests/ (foldrun-admin's web/tests), and their
 *  helpers. */
export const BILLING_TESTS = [
  "console-access-keys.ts",
  "admin-export.test.ts",
  "billing-admin.test.ts",
  "billing-checkout.test.ts",
  "stripe-e2e.test.ts",
  "console-e2e.test.ts",
  "billing-notices-billing.test.ts",
  "consistency-billing.test.ts",
  "flags-routes.test.ts",
  "status-routes.test.ts",
  "stripe.test.ts",
  "support-view.test.ts",
  "admin-api-contract.test.ts",
  "admin-op.ts",
];

const ROOT = path.join(import.meta.dirname, "..");

/** True on a checkout that carries billing (foldrun-admin laid over it),
 *  false on the public one, where none of BILLING_FILES is there. */
export const billingPresent: boolean = BILLING_FILES.every((p) => fs.existsSync(path.join(ROOT, p)));

/** An API operation ("GET /api/billing/plans") or path that is billing's:
 *  the customer billing routes and support's. */
export const isBillingRoute = (op: string): boolean => /(^|\s)\/api\/(billing|support)(\/|$|\s)/.test(op);
