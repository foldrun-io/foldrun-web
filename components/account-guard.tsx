"use client";

// Every write a dashboard page makes names the account the page is showing.
//
// One login may be in several accounts (FOL-464) and the session cookie is
// every tab's: when another tab moves the session to another account, this
// tab still shows the old one. The server refuses a write whose named
// account is not the session's (server/auth.ts accountMoved, 412), so a
// click on a stale page can never land in the other account. Naming it here,
// once, for every same-origin /v1 write, means no component has to remember;
// and a refusal reloads the page, which then shows the account the browser
// is in.

import { useEffect } from "react";

export function AccountGuard({ account, as }: { account: string; as: string }) {
  useEffect(() => {
    if (!account) return;
    const plain = window.fetch;
    window.fetch = async (input, init) => {
      let named = false;
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
        if (method !== "GET" && method !== "HEAD" && url.origin === window.location.origin && url.pathname.startsWith("/v1/")) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("x-foldrun-account")) headers.set("x-foldrun-account", account);
          // And the person it is showing: another tab may have signed in as someone else here.
          if (!headers.has("x-foldrun-as")) headers.set("x-foldrun-as", as);
          init = { ...init, headers };
          named = true;
        }
      } catch {
        // A request this cannot read goes out as it was written.
      }
      const res = await plain(input, init);
      if (named && res.status === 412) window.location.reload();
      return res;
    };
    return () => {
      window.fetch = plain;
    };
  }, [account, as]);
  return null;
}
