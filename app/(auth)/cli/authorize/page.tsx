import { $t } from "@/i18n";
import { Suspense } from "react";
import { AuthCard } from "../../brand";
import { CliAuthorize } from "./authorize";

import { requestLocale } from "@/server/locale";
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("auth.cli-authorize-page.signInTheCli") };
}

// `foldrun login` sent the person here with a code in the URL. The page
// asks one question — is this your terminal? — and answers it to the row
// the CLI is polling. Nothing else happens here; there is nowhere to go on
// from it but back to the terminal.
export default async function CliAuthorizePage() {
  await requestLocale();
  return (
    <AuthCard>
      <Suspense>
        <CliAuthorize />
      </Suspense>
    </AuthCard>
  );
}
