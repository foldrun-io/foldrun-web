// The reset link lands here with its token; a new password signs you in.
import { $t } from "@/i18n";
import { ResetForm } from "./form";
import { AuthCard } from "../brand";
import { Callout } from "@foldrun/ui/react/page";

export const metadata = { title: $t("auth.reset-page.chooseANewPasswordFoldrun") };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthCard title={$t("auth.reset-page.chooseANewPassword")} hint={$t("auth.reset-page.atLeast10CharactersEveryOther")}>
      {token ? <ResetForm token={token} /> : <Callout tone="danger">{$t("auth.reset-page.thisLinkIsMissingItsToken")}</Callout>}
    </AuthCard>
  );
}
