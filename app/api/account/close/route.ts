// The owner asks to close the account.
//
//   POST /api/account/close  { confirm: "<account name>", reason?: "…" }
//
// Not a delete. The account is suspended at once — no new runs, runs in
// flight finish — and the super admin is mailed to settle what is left: the
// last invoice, any refund, when the data goes. People can still sign in,
// read everything and take the export; a closed account that could not be
// read would turn "I want to leave" into "I lost my work".
//
// The owner in person only, never a key, and only with the account's name
// typed back: this is the one request in the product that cannot be undone
// by the person who made it.

import { NextRequest, NextResponse } from "next/server";
import { requireOwner, requireHosted, errorResponse, ApiError } from "@/server/api";
import { adminState, updateAdminState, platformAccount } from "@/platform/admin";
import { findUserById, ownerOf } from "@/server/users";
import { sendCloseRequestNotice } from "@/server/email";
import { audit } from "@/server/audit";
import { billing } from "@/platform/billing";

export async function POST(req: NextRequest) {
  try {
    requireHosted();
    const { tenant, userId } = await requireOwner(req);
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown; reason?: unknown };
    if (body.confirm !== tenant) throw new ApiError(`type the account's name, ${tenant}, to confirm`, 400);
    if (tenant === platformAccount()) throw new ApiError("the platform's own account cannot be closed from here", 409);
    const state = await adminState(tenant);
    if (state.closeRequested) throw new ApiError(`already asked on ${state.closeRequested.at.slice(0, 10)} — the platform team has it`, 409);
    const me = await findUserById(userId);
    const by = me?.email ?? userId;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const at = new Date().toISOString();
    await updateAdminState(
      tenant,
      {
        closeRequested: { at, by, ...(reason ? { reason } : {}) },
        // An existing suspension keeps its own reason; the close is on record either way.
        ...(state.suspended ? {} : { suspended: { at, by, reason: "closed at the owner's request" } }),
      },
      by,
      "close-request",
      { reason },
    );
    // Nothing renews after this (28 Oct 2026): a plan stops at the end of
    // what was paid for. If that cannot be done now the close still stands
    // and the super admin's mail says so — they settle what is left anyway.
    const billed = await billing()
      .accountClosing(tenant, by)
      .catch((err: unknown) => ({ outcome: `the subscription could not be stopped: ${err instanceof Error ? err.message : String(err)}`, failed: true as const }));
    await audit("account.close_requested", { actor: by, tenant, detail: { reason, billing: billed.outcome } });
    const admin = await ownerOf(platformAccount());
    const mail = admin?.email ? await sendCloseRequestNotice(platformAccount(), admin.email, tenant, by, reason ? `${reason}\n\nBilling: ${billed.outcome}` : `Billing: ${billed.outcome}`) : { ok: false as const, error: "no super admin to tell" };
    if (!mail.ok) console.error(`[foldrun] close request for ${tenant}: super admin not mailed — ${mail.error}`);
    return NextResponse.json({ ok: true, suspended: true, notified: mail.ok, billing: billed.outcome });
  } catch (err) {
    return errorResponse(err);
  }
}
