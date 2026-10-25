// A browser OAuth consent is bound to the browser that starts it (RFC 9700
// §2.1): the start sets a random cookie, the parked consent keeps its hash,
// and the callback refuses a code that comes back without it — a consent
// link sent to someone else connects nothing. A caller with no browser of
// its own here (an API key: the CLI) gets a hand-off page instead, where a
// signed-in person accepts the connection before any provider is asked.

import { NextRequest, NextResponse } from "next/server";
import { startOAuthConnect, newBinding, parkHandoff, type OAuthProviderConfig } from "@/platform/oauth-connect";
import { sessionCookieOptions } from "@/server/users";
import { publicOrigin, browserHost } from "@/server/auth-flows";
import type { Actor } from "@/server/auth";
import { NO_REPLAY_HEADER } from "@/server/idempotency";

const TTL_MS = 10 * 60 * 1000;

/** The cookie a consent's binding rides in: one per consent, so two
 *  connects in two tabs do not unbind each other. */
export const bindingCookie = (state: string) => `foldrun_oauth_${state.slice(0, 16)}`;

/** The redirect URI every consent uses (FOLDRUN_OAUTH_CALLBACK_URL pins it). */
export const callbackUri = (req: NextRequest) => process.env.FOLDRUN_OAUTH_CALLBACK_URL || `${publicOrigin(req)}/api/oauth/callback`;

/** A person in a browser, who can be bound — or a key, who gets a hand-off.
 *  Dev mode (FOLDRUN_DEV_NO_AUTH) is the person at the keyboard. */
export const inBrowser = (actor: Actor) => actor.kind === "user" || (actor.kind === "key" && actor.id === "dev");

/** Start a browser-bound consent: the provider's URL, with the binding cookie set. */
export async function startBound(
  req: NextRequest,
  tenant: string,
  secret: string,
  config: OAuthProviderConfig,
  workspace: string | undefined,
  extra: Record<string, unknown> = {},
  handoffId?: string,
): Promise<NextResponse> {
  // The binding cookie can only reach the callback if it is on the callback's
  // own host. A callback pinned to another address than the one this page is
  // open at cannot be bound — and handing the binding over in a URL would
  // undo what binding is for — so the person is sent to that address.
  const callback = new URL(callbackUri(req));
  if (callback.host !== browserHost(req)) {
    return NextResponse.json({ error: `open the dashboard at ${callback.origin} to connect — the consent must come back to the browser that starts it` }, { status: 409 });
  }
  const binding = newBinding();
  const { url, nonce } = await startOAuthConnect(tenant, secret, config, callback.href, workspace, binding.hash, handoffId);
  // Not replayable: an Idempotency-Key retry must get its own cookie with
  // its own consent, not the first one's URL without the cookie.
  const res = NextResponse.json({ ok: true, url, ...extra }, { headers: { [NO_REPLAY_HEADER]: "1" } });
  res.cookies.set(bindingCookie(nonce), binding.cookie, {
    ...sessionCookieOptions(req, new Date(Date.now() + TTL_MS)),
    path: "/api/oauth/callback",
  });
  return res;
}

/** Park a hand-off for a caller with no browser of its own; answers the page's URL. */
export async function handoff(
  req: NextRequest,
  tenant: string,
  actor: Actor,
  h: { client: string; secret: string; workspace?: string; scopes?: string | null },
): Promise<NextResponse> {
  const id = await parkHandoff({
    tenant,
    client: h.client,
    name: h.secret,
    ...(h.workspace ? { workspace: h.workspace } : {}),
    // Kept even when empty: a connection made with no scopes reconnects with none.
    ...(typeof h.scopes === "string" ? { scopes: h.scopes } : {}),
    by: actor.name,
  });
  return NextResponse.json({ ok: true, url: `${publicOrigin(req)}/dashboard/connect/${id}`, handoff: true });
}
