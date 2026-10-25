// What the dashboard says about money: the balance shown on the home page and
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
