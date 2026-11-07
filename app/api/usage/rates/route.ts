// The rates this account is charged, its plan's terms and the price list for
// foldrun's models: the Rates tab of the Usage page (FOL-125). The same data
// as the public /api/pricing, plus where this account stands.

import { NextRequest } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { versionedJson } from "@/server/api-version";
import { billing } from "@/platform/billing";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const b = billing();
    const catalogue = b.catalogue?.() ?? null;
    // A caller limited to some workspaces does not read the account's wallet.
    const credits = actor.workspaces ? null : await b.accountCredits?.(tenant) ?? null;
    return versionedJson(req, { rates: b.meterRates?.() ?? null, plan: credits?.plan ?? null, catalogue });
  } catch (err) {
    return errorResponse(err);
  }
}
