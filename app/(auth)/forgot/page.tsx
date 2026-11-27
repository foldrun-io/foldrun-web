// "I forgot my password." One field; the answer is the same whatever you
// type, because this page must not be a way to learn who has an account.
import { $t } from "@/i18n";
import { RESET_LIFETIME_TEXT } from "@/server/lifetimes";
import { ForgotForm } from "./form";
import { AuthCard } from "../brand";

import { requestLocale } from "@/server/locale";
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("auth.forgot-page.resetYourPasswordFoldrun") };
}

export default async function ForgotPage() {
  await requestLocale();
  return (
    <AuthCard
      title={$t("auth.forgot-page.resetYourPassword")}
      hint={$t("auth.forgot-page.enterYourEmailAndWeWill", { lifetime: RESET_LIFETIME_TEXT })}
      footer={
        <a href="/login" className="hover:text-fg">
          {$t("auth.forgot-page.backToSignIn")}
        </a>
      }
    >
      <ForgotForm />
    </AuthCard>
  );
}
