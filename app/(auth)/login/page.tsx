import { $rich, $t } from "@/i18n";
import { Suspense } from "react";
import Link from "@foldrun/ui/react/link";
import { AuthForm } from "../auth-form";
import { AuthCard } from "../brand";
import { codeSignInAvailable } from "@/server/login-codes";

export const metadata = { title: $t("auth.login-page.signIn") };

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthCard
      title={$t("auth.login-page.signIn")}
      hint={$t("auth.login-page.yourAgentsKeptWorkingSeeWhat")}
      footer={
        <>
          {$rich("auth.login-page.newHereCreateAnAccount", { link: (chunks) => <Link href="/signup" className="font-medium text-fg hover:underline">{chunks}</Link> })}
        </>
      }
    >
      <Suspense>
        <AuthForm mode="login" codeSignIn={codeSignInAvailable()} />
      </Suspense>
    </AuthCard>
  );
}
