// One-click unsubscribe (RFC 8058). No login: the signed token in the URL is
// the whole credential, and it can do one thing — turn off the category of
// mail it was minted for, for the address it was minted for.
//
// Every optional mail carries
//
//   List-Unsubscribe: <https://…/api/unsubscribe?token=…>
//   List-Unsubscribe-Post: List-Unsubscribe=One-Click
//
// and a mail client's own Unsubscribe button POSTs here with the body
// `List-Unsubscribe=One-Click`. The confirmation page (/unsubscribe) posts
// the same token from its form and is sent back to itself to say it is done.
//
// Never on a GET: inbox link-checkers follow links, and one that turned off
// a person's alerts by previewing a mail would be a bug in our favour.
//
// Answers 200 { ok, category, workspace } — or 303 to the page for the form;
// 400/401/410 for a missing, forged or expired token.

import { NextRequest, NextResponse } from "next/server";
import { readUnsubscribeToken, mailCategory } from "@/lib/mail";
import { setPreference } from "@/platform/email-preferences";
import { errorResponse, refuse } from "@/server/api";

export async function POST(req: NextRequest) {
  try {
    let token = req.nextUrl.searchParams.get("token");
    const type = req.headers.get("content-type") ?? "";
    let fromPage = false;
    if (!token && type.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(await req.text());
      token = form.get("token");
      fromPage = form.get("from") === "page";
    } else if (!token && type.includes("application/json")) {
      token = ((await req.json().catch(() => ({}))) as { token?: string }).token ?? null;
    }
    const read = readUnsubscribeToken(token);
    if ("error" in read) return refuse(read.error, read.status);
    const { claim } = read;
    const cat = mailCategory(claim.category);
    // A token is only ever minted for an optional category; one naming a
    // required category is not a thing this route turns off.
    if (!cat || cat.required) return refuse("this mail cannot be unsubscribed from", 409);
    await setPreference(claim.tenant, claim.email, claim.category, false, { workspace: claim.workspace, source: "unsubscribe" });
    if (fromPage) {
      const to = req.nextUrl.clone();
      to.pathname = "/unsubscribe";
      to.search = `?token=${encodeURIComponent(token!)}&done=1`;
      return NextResponse.redirect(to, 303);
    }
    return NextResponse.json({ ok: true, category: claim.category, workspace: claim.workspace });
  } catch (err) {
    return errorResponse(err);
  }
}
