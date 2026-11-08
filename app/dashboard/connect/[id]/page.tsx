// A connection started from a terminal (`foldrun connect --client`), waiting
// for a signed-in person to accept it here before the provider is asked. The
// consent that follows is bound to this browser (server/oauth-browser.ts):
// a connect link sent to someone else cannot land their account's grant in
// yours, nor yours in theirs.

import { cookies } from "next/headers";
import { peekHandoff } from "@/platform/oauth-connect";
import { verifySession, SESSION_COOKIE } from "@/server/users";
import { Page, PageHeader, SettingsCard, EmptyState } from "@foldrun/ui/react/page";
import { Link2Off } from "lucide-react";
import { HandoffAccept } from "./accept";
import { WithEmails } from "@/components/email";

export default async function ConnectHandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const tenant = session?.tenant ?? (process.env.FOLDRUN_DEV_NO_AUTH === "1" ? "default" : null);
  const h = await peekHandoff(id);
  const usable = h && tenant && h.tenant === tenant;
  return (
    <Page width="narrow" className="pb-16">
      <PageHeader title="Connect an account" description={usable ? "A connection was started from a terminal. Check it is yours before you go on." : undefined} />
      {!usable ? (
        <EmptyState icon={<Link2Off />} title="This link no longer works" description="It expired, was already used, or belongs to another account. Start it again from where you began." />
      ) : (
        <SettingsCard title="The connection" description="Accepting sends you to the provider to approve it; the grant lands in this secret." footer={<HandoffAccept id={id} tenant={tenant!} />}>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2.5 text-sm">
            <dt className="text-fg-muted">Secret</dt>
            <dd className="break-all font-mono text-fg">{h.name}</dd>
            <dt className="text-fg-muted">Stored in</dt>
            <dd className="text-fg">{h.workspace ? `workspace ${h.workspace}` : "the account"}</dd>
            <dt className="text-fg-muted">App</dt>
            <dd className="break-all font-mono text-fg">{h.client}</dd>
            <dt className="text-fg-muted">Scopes</dt>
            <dd className="break-all font-mono text-xs text-fg">{h.scopes === undefined ? "the app's default" : h.scopes || "none"}</dd>
            <dt className="text-fg-muted">Started by</dt>
            <dd className="text-fg">
              <WithEmails text={h.by} />
            </dd>
          </dl>
        </SettingsCard>
      )}
    </Page>
  );
}
