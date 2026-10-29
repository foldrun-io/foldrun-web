"use client";

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
