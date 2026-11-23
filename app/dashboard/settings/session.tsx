"use client";

// The sign-out button. A form-less POST and a hard refresh — the proxy does
// the rest by bouncing the next dashboard request to /login.

import { $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/v1/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className={buttonVariants({ variant: "secondary" })}
    >
      {$t("settings.session.signOut")}
    </button>
  );
}
