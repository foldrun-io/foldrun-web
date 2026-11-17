// "I forgot my password." One field; the answer is the same whatever you
// type, because this page must not be a way to learn who has an account.
import { $t } from "@/i18n";
import { ForgotForm } from "./form";
import { AuthCard } from "../brand";

export const metadata = { title: $t("auth.forgot-page.resetYourPasswordFoldrun") };

export default function ForgotPage() {
  return (
    <AuthCard
      title={$t("auth.forgot-page.resetYourPassword")}
      hint={$t("auth.forgot-page.enterYourEmailAndWeWill")}
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
