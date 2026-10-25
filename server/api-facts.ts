// What GET /api/account/api and Settings → API show: the account's rate
// limits, its API version pin, and how it has met the API lately — the
// versions that answered its requests, and any route on its way out it still
// calls, with who calls it and when it stops. One function so the page, the
// route and `foldrun api version` cannot disagree.

import { adminState } from "@/platform/admin";
import { apiUsageFor } from "@/platform/api-usage";
import { accountProfile, limitsFor } from "./api-limits.ts";
import { CURRENT_API_VERSION, DEPRECATIONS, VERSION_SUPPORT_MONTHS, releasedVersions, type Deprecation } from "./api-version.ts";

/** The last 30 days, with each deprecated route's dates beside its use. */
export async function apiUsageFacts(tenant: string, deprecations: Deprecation[] = DEPRECATIONS) {
  try {
    const usage = await apiUsageFor(tenant, 30);
    return {
      ...usage,
      deprecated: usage.deprecated.map((d) => {
        const dep = deprecations.find((x) => x.route === d.route);
        return { ...d, deprecatedAt: dep?.deprecatedAt ?? null, sunsetAt: dep?.sunsetAt ?? null, link: dep?.link ?? null };
      }),
    };
  } catch (err) {
    console.error("[api-usage] read failed:", err);
    return null; // the page and the route still answer; the numbers say they are missing
  }
}

export async function apiFactsFor(tenant: string) {
  const profile = await accountProfile(tenant);
  let pinned: string | null = null;
  try {
    pinned = (await adminState(tenant)).apiVersion ?? null;
  } catch {}
  const supported = releasedVersions();
  return {
    version: {
      current: CURRENT_API_VERSION,
      pinned,
      effective: pinned && supported.includes(pinned) ? pinned : CURRENT_API_VERSION,
      supported,
      supportMonths: VERSION_SUPPORT_MONTHS,
    },
    limits: limitsFor(profile.tier),
    usage: await apiUsageFacts(tenant),
  };
}
