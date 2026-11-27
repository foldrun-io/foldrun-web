// Where a confirmation link, and the link that moves a login to a new
// address, land (FOL-319). Showing the page decides nothing — inbox scanners
// and link previews open every link — so it asks, and the button posts the
// token to /v1/auth/verify, which confirms (or moves) and goes on to the
// dashboard. A confirmation also says what to do if you never signed up:
// confirming would hand a working login to whoever used your address.

import { $el, $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { buttonVariants } from "@foldrun/ui/react/button";
import { cn } from "@foldrun/ui/react/cn";
import { Email } from "@/components/email";
import { readToken } from "@/server/auth-tokens";
import { AuthCard } from "../brand";

import { requestLocale } from "@/server/locale";
// The token is in this page's URL: a Referer carries only our origin, never the
// path and query (Codex). Not no-referrer: that makes the button's POST send
// Origin: null, which the proxy refuses as cross-site for a signed-in browser.
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("auth.verify-page.confirmYourEmailFoldrun"), referrer: "strict-origin" as const };
}
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  await requestLocale();
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : ""; // a repeated ?token= is no link
  const move = readToken("email-change", token);
  const confirm = move ? null : readToken("verify", token);
  const heading = "mb-1.5 text-xl font-semibold tracking-tight text-fg";
  if (!move && !confirm) {
    return (
      <AuthCard>
        <h1 className={heading}>{$t("auth.verify-page.thisLinkDoesNotWork")}</h1>
        <p className="text-sm text-fg-muted">
          {$rich("auth.verify-page.itExpiredOrIsIncomplete", { link: (chunks) => <Link href="/login" className="font-medium text-fg hover:underline">{chunks}</Link> })}
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard>
      <h1 className={heading}>{move ? $t("auth.verify-page.moveYourLogin") : $t("auth.verify-page.confirmYourEmail")}</h1>
      <p className="mb-6 text-sm text-fg-muted">
        {move
          ? $rich("auth.verify-page.moveFromTo", { from: $el(<Email value={move.e} className="font-medium text-fg" />), to: $el(<Email value={move.to} className="font-medium text-fg" />) })
          : $rich("auth.verify-page.confirmThatIsYours", { email: $el(<Email value={confirm!.e} className="font-medium text-fg" />) })}
      </p>
      <form method="post" action="/v1/auth/verify">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}>
          {move ? $t("auth.verify-page.moveMyLogin") : $t("auth.verify-page.confirmThisAddress")}
        </button>
      </form>
      {!move && (
        <p className="mt-6 text-sm text-fg-muted">
          {$rich("auth.verify-page.didNotSignUp", { link: (chunks) => <Link href="/forgot" className="font-medium text-fg hover:underline">{chunks}</Link> })}
        </p>
      )}
    </AuthCard>
  );
}
