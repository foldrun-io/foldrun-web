import { Suspense } from "react";
import { CliAuthorize } from "./authorize";

export const metadata = { title: "Sign in the CLI" };

// `foldrun login` sent the person here with a code in the URL. The page
// asks one question — is this your terminal? — and answers it to the row
// the CLI is polling. Nothing else happens here; there is nowhere to go on
// from it but back to the terminal.
export default function CliAuthorizePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <Suspense>
          <CliAuthorize />
        </Suspense>
      </div>
    </main>
  );
}
