// The feature flags as they stand for the caller's account — read-only.
// Only the super admin changes a flag (/api/admin/flags); an account sees
// what is on for it, and why: its own override, the install-wide setting,
// a rollout, or the default.
//
//   GET   { flags: [{ name, description, owner, default, on, source, rollout }] }

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse } from "@/server/api";
import { effectiveFlags } from "@/platform/flags";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant(req);
    return NextResponse.json({ flags: await effectiveFlags(tenant) });
  } catch (err) {
    return errorResponse(err);
  }
}
