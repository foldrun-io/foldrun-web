"use client";

// The sign-out button. A form-less POST and a hard refresh — the proxy does
// the rest by bouncing the next dashboard request to /login.

import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/kit/button";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className={buttonVariants({ variant: "secondary" })}
    >
      Sign out
    </button>
  );
}
