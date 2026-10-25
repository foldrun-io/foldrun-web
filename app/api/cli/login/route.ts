// `foldrun login`, step one: the CLI asks for a code.
//
// Open on purpose — there is no credential yet; that is what is being made.
// The answer names the page the person confirms on, so the CLI can print it
// for a machine with no browser.

import { NextRequest, NextResponse } from "next/server";
import { beginCliLogin, POLL_SECONDS } from "@/server/cli-login";
import { errorResponse } from "@/server/api";
import { publicOrigin } from "@/server/auth-flows";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { hostname?: string };
    const row = await beginCliLogin(String(body.hostname ?? ""));
    const origin = publicOrigin(req);
    return NextResponse.json({
      id: row.id,
      code: row.code,
      verifyUrl: `${origin}/cli/authorize?code=${row.code}`,
      expiresAt: row.expiresAt,
      interval: POLL_SECONDS,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
