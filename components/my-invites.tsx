"use client";

// The invites waiting on the signed-in person (FOL-464, GET /v1/me/invites):
// each with Join, which opens the invite's own page, and Decline. Shown at
// the top of the inbox; nothing when there is none.

import { $t, $rich, $el } from "@/i18n";
import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Button, buttonVariants } from "@foldrun/ui/react/button";
import { Callout, IconBox } from "@foldrun/ui/react/page";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Email } from "./email";
import { ROLE_LABEL } from "./value-labels";

export interface MyInvite {
  id: string;
  account: string;
  role: string;
  invitedBy: string;
  path: string;
}

/** The person's waiting invites, read once; `again` reads them anew. */
export function useMyInvites(): [MyInvite[], () => void] {
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/v1/me/invites")
      .then((r) => (r.ok ? r.json() : { invites: [] }))
      .then((d: { invites?: MyInvite[] }) => live && setInvites(d.invites ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tick]);
  return [invites, () => setTick((n) => n + 1)];
}

export function MyInvites() {
  const [invites, again] = useMyInvites();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (invites.length === 0) return null;

  async function decline(inv: MyInvite) {
    if (!(await confirm({ title: $t("components.my-invites.declineTitle", { account: inv.account }), body: $t("components.my-invites.declineBody"), confirmLabel: $t("components.my-invites.decline") }))) return;
    setBusy(inv.id);
    setFailed(false);
    const res = await fetch(`/v1/me/invites/${encodeURIComponent(inv.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "decline" }) }).catch(() => null);
    if (!res?.ok) setFailed(true);
    setBusy(null);
    again();
  }

  return (
    <section className="mb-6 space-y-3">
      {confirmDialog}
      <h2 className="px-1 text-base font-medium text-fg">{$t("components.my-invites.title")}</h2>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul className="divide-y divide-line">
          {invites.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <IconBox round className="max-sm:hidden"><Mail /></IconBox>
              <p className="min-w-0 flex-1 text-sm text-fg">
                {$rich("components.my-invites.invitedYou", { email: $el(<Email value={inv.invitedBy} />), account: () => <span className="font-mono">{inv.account}</span>, role: ROLE_LABEL[inv.role] ?? inv.role })}
              </p>
              <Button variant="ghost" disabled={busy === inv.id} onClick={() => void decline(inv)}>{$t("components.my-invites.decline")}</Button>
              <a href={inv.path} className={buttonVariants({ variant: "primary" })}>{$t("components.my-invites.join")}</a>
            </li>
          ))}
        </ul>
      </div>
      {failed && <Callout tone="danger">{$t("components.my-invites.couldNot")}</Callout>}
    </section>
  );
}
