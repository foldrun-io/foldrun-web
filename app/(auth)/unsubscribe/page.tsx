// Where the "stop these emails" link in an optional mail lands. No login:
// the token in the link says who and what. Showing the page decides nothing
// — inbox link-checkers open links — so it asks, and the button posts the
// token to /api/unsubscribe, which sends the browser back here to say done.
// A mail client's own Unsubscribe button skips this page and posts directly
// (RFC 8058).

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { readUnsubscribeToken, mailCategory } from "@/lib/mail";
import { buttonVariants } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { AuthCard } from "../brand";

export const metadata = { title: $t("auth.unsubscribe-page.unsubscribeFoldrun") };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token = "", done } = await searchParams;
  const read = readUnsubscribeToken(token);
  const body = (() => {
    if ("error" in read) {
      return (
        <>
          <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-fg">{$t("auth.unsubscribe-page.thisLinkDoesNotWork")}</h1>
          <p className="text-sm text-fg-muted">
            {read.status === 410 ? read.error : $t("auth.unsubscribe-page.itIsIncompleteOrWasNot")}
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
          <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-fg">{$t("auth.unsubscribe-page.unsubscribed")}</h1>
          <p className="mb-4 text-sm text-fg-muted">
            {$rich("auth.unsubscribe-page.willGetNoMoreEverythingElse", { email: claim.email, strong: (chunks) => <strong className="text-fg">{chunks}</strong>, what: what })}
          </p>
          <p className="text-sm text-fg-muted">
            {$rich("auth.unsubscribe-page.changedYourMindTurnItBack", { link: (chunks) => <Link href="/dashboard/profile?tab=notifications#notifications" className="font-medium text-fg hover:underline">{chunks}</Link> })}
          </p>
        </>
      );
    }
    return (
      <>
        <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-fg">{$t("auth.unsubscribe-page.stop", { what: what })}</h1>
        <p className="mb-6 text-sm text-fg-muted">
          {$rich("auth.unsubscribe-page.for", { email: claim.email, strong: (chunks) => <strong className="text-fg">{chunks}</strong>, description: cat.description })}
        </p>
        <form method="post" action="/api/unsubscribe">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="from" value="page" />
          <button type="submit" className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}>{$t("auth.unsubscribe-page.unsubscribe")}</button>
        </form>
      </>
    );
  })();
  return <AuthCard>{body}</AuthCard>;
}
