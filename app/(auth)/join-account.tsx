"use client";

// One button for a signed-in person on an invite page: join the invite's
// account, or open an account they are already in. Either way the session
// moves there (POST /v1/auth/session) and the dashboard opens.

import { $t } from "@/i18n";
import { useState } from "react";
import { Button } from "@foldrun/ui/react/button";
import { Callout } from "@foldrun/ui/react/page";

/** `from` and `as` are the account and the person this page showed as signed
 *  in: the server refuses the move when the browser has since become another
 *  (another tab switched account, or signed in as someone else). */
export function JoinAccount({ invite, account, label, from, as }: { invite?: string; account?: string; label: string; from: string; as: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/v1/auth/session", {
            method: "POST",
            headers: { "content-type": "application/json", "x-foldrun-account": from, "x-foldrun-as": as },
            body: JSON.stringify(invite ? { invite, as } : { account, as }),
          }).catch(() => null);
          if (res?.ok) {
            // Other tabs of this browser are in the old account's pages: they reload (components/user-menu.tsx).
            if (typeof BroadcastChannel !== "undefined") new BroadcastChannel("foldrun-account").postMessage("moved");
            // A full navigation: the dashboard is another account's now.
            window.location.assign(new URL("/dashboard", window.location.origin).href);
            return;
          }
          const said = res ? ((await res.json().catch(() => ({}))) as { error?: string | { message?: string } }).error : undefined;
          setError((typeof said === "string" ? said : said?.message) || $t("auth.join-account.couldNotJoin"));
          setBusy(false);
        }}
      >
        {label}
      </Button>
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}

/** Sign out here, then come back to the same page: for a person signed in
 *  with another address than the invite's. */
export function SignOutHere() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/v1/auth/logout", { method: "POST" }).catch(() => {});
        window.location.reload();
      }}
    >
      {$t("auth.join-account.signOut")}
    </Button>
  );
}
