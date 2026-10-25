// Where the provider sends the browser back. The state nonce is single-use,
// expiring and bound to the tenant that started; the consent is also bound to
// the browser that started it (a cookie, server/oauth-browser.ts), and the
// provider's `iss` is checked when it sends one (RFC 9207). Success and failure both land the
// person back on Settings, with the outcome in the URL for the page to show.

import { NextRequest, NextResponse } from "next/server";
import { completeOAuthConnect } from "@/platform/oauth-connect";
import { errorStatus } from "@/server/api";
import { publicOrigin } from "@/server/auth-flows";
import { bindingCookie, callbackUri } from "@/server/oauth-browser";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const settings = new URL("/dashboard/settings", publicOrigin(req));

  const providerError = params.get("error");
  if (providerError) {
    settings.searchParams.set("connect_error", params.get("error_description") ?? providerError);
    return NextResponse.redirect(settings);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    settings.searchParams.set("connect_error", "the provider sent no code back");
    return NextResponse.redirect(settings);
  }

  try {
    // The token exchange must name the redirect_uri the authorisation used,
    // and start/reconnect use FOLDRUN_OAUTH_CALLBACK_URL when it is set.
    const result = await completeOAuthConnect(state, code, callbackUri(req), {
      binding: req.cookies.get(bindingCookie(state))?.value,
      iss: params.get("iss"),
    });
    settings.searchParams.set("connected", result.name);
    if (result.stored === "static") settings.searchParams.set("connected_static", "1");
    const res = NextResponse.redirect(settings);
    res.cookies.set(bindingCookie(state), "", { path: "/api/oauth/callback", maxAge: 0 });
    return res;
  } catch (err) {
    // errorStatus hides an internal error's text; a URL is no place for it.
    const { message } = errorStatus(err);
    settings.searchParams.set("connect_error", message);
    return NextResponse.redirect(settings);
  }
}
