import { Suspense } from "react";
import Link from "@foldrun/ui/react/link";
import { AuthForm } from "../auth-form";
import { AuthCard } from "../brand";

export const metadata = { title: "Sign in" };

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
        <AuthForm mode="login" />
      </Suspense>
    </AuthCard>
  );
}
