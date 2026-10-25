"use client";

// The sign-out button. A form-less POST and a hard refresh — the proxy does
// the rest by bouncing the next dashboard request to /login.

import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className={buttonClass("secondary")}
    >
      Sign out
    </button>
  );
}
