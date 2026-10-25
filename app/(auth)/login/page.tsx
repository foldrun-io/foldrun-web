import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "../auth-form";
import { Brand } from "../brand";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <Brand />
        <h1 className="mb-1 text-xl font-semibold text-fg">Sign in</h1>
        <p className="mb-6 text-sm text-fg-muted">Your agents kept working. See what they did.</p>
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
        <p className="mt-6 text-center text-sm text-fg-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-fg underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
