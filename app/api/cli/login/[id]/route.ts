// `foldrun login`, step three: the CLI asks whether the person said yes.
// The id is the secret; the key rides back on the first approved answer and
// never again.

import { NextRequest, NextResponse } from "next/server";
import { pollCliLogin } from "@/server/cli-login";
import { errorResponse } from "@/server/api";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const answer = await pollCliLogin(id);
    if (answer.status !== "approved") return NextResponse.json({ status: answer.status });
    const { key, tenant, email, role } = answer.grant;
    return NextResponse.json({ status: "approved", token: key, account: tenant, email, role });
  } catch (err) {
    return errorResponse(err);
  }
}
