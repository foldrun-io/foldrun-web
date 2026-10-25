// A connection started from a terminal (`foldrun connect --client`), waiting
// for a signed-in person to accept it here before the provider is asked. The
// consent that follows is bound to this browser (server/oauth-browser.ts):
// a connect link sent to someone else cannot land their account's grant in
// yours, nor yours in theirs.

import { cookies } from "next/headers";
import { peekHandoff } from "@/platform/oauth-connect";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { Card } from "@/components/ui";
import { HandoffAccept } from "./accept";
import { WithEmails } from "@/components/email";

export default async function ConnectHandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const tenant = session?.tenant ?? (process.env.FOLDRUN_DEV_NO_AUTH === "1" ? "default" : null);
  const h = await peekHandoff(id);
  const usable = h && tenant && h.tenant === tenant;
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-lg font-semibold text-fg">Connect an account</h1>
      {!usable ? (
        <p className="mt-3 text-sm text-fg-muted">
          This connect link expired, was already used, or belongs to another account. Start it again from where you
          began.
        </p>
      ) : (
        <Card className="mt-4 max-w-xl p-5">
          <p className="text-sm text-fg-muted">A connection was started from a terminal. Check it is yours before you go on.</p>
          <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-fg-muted">Secret</dt>
            <dd className="font-mono text-fg">{h.name}</dd>
            <dt className="text-fg-muted">Stored in</dt>
            <dd className="text-fg">{h.workspace ? `workspace ${h.workspace}` : "the account"}</dd>
            <dt className="text-fg-muted">App</dt>
            <dd className="font-mono text-fg">{h.client}</dd>
            <dt className="text-fg-muted">Scopes</dt>
            <dd className="break-all font-mono text-xs text-fg">{h.scopes === undefined ? "the app's default" : h.scopes || "none"}</dd>
            <dt className="text-fg-muted">Started by</dt>
            <dd className="text-fg"><WithEmails text={h.by} /></dd>
          </dl>
          <HandoffAccept id={id} tenant={tenant!} />
        </Card>
      )}
    </div>
  );
}
