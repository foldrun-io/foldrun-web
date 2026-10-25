// Where the "stop these emails" link in an optional mail lands. No login:
// the token in the link says who and what. Showing the page decides nothing
// — inbox link-checkers open links — so it asks, and the button posts the
// token to /api/unsubscribe, which sends the browser back here to say done.
// A mail client's own Unsubscribe button skips this page and posts directly
// (RFC 8058).

import Link from "next/link";
import { readUnsubscribeToken, mailCategory } from "@/lib/mail";
import { buttonClass } from "@/components/ui";
import { Brand } from "../brand";

export const metadata = { title: "Unsubscribe — foldrun" };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token = "", done } = await searchParams;
  const read = readUnsubscribeToken(token);
  const body = (() => {
    if ("error" in read) {
      return (
        <>
          <h1 className="mb-1 text-lg font-semibold text-fg">This link does not work</h1>
          <p className="text-sm text-fg-muted">
            {read.status === 410 ? read.error : "It is incomplete or was not made by this install. Open it from the email again, or sign in and change what you receive under Profile → Notifications."}
          </p>
        </>
      );
    }
    const { claim } = read;
    const cat = mailCategory(claim.category)!;
    const what = `${cat.label.toLowerCase()}${claim.workspace ? ` from ${claim.workspace}` : ""}`;
    if (done) {
      return (
        <>
          <h1 className="mb-1 text-lg font-semibold text-fg">Unsubscribed</h1>
          <p className="mb-4 text-sm text-fg-muted">
            <strong className="text-fg">{claim.email}</strong> will get no more {what}. Everything else you receive is unchanged — and mail about security, invites and failed payments is always sent.
          </p>
          <p className="text-sm text-fg-muted">
            Changed your mind? Turn it back on under <Link href="/dashboard/profile#notifications" className="font-medium text-fg hover:underline">Profile → Notifications</Link>.
          </p>
        </>
      );
    }
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-fg">Stop {what}?</h1>
        <p className="mb-6 text-sm text-fg-muted">
          For <strong className="text-fg">{claim.email}</strong>. {cat.description}
        </p>
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="from" value="page" />
          <button type="submit" className={buttonClass("primary")}>Unsubscribe</button>
        </form>
      </>
    );
  })();
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Brand />
      {body}
    </main>
  );
}
