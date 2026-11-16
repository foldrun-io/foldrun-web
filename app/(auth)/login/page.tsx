import { Suspense } from "react";
import Link from "@foldrun/ui/react/link";
import { AuthForm } from "../auth-form";
import { AuthCard } from "../brand";
import { codeSignInAvailable } from "@/server/login-codes";

export const metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      hint="Your agents kept working. See what they did."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-fg hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense>
        <AuthForm mode="login" codeSignIn={codeSignInAvailable()} />
      </Suspense>
    </AuthCard>
  );
}
