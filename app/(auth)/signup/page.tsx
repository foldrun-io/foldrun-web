import { Suspense } from "react";
import Link from "next/link";
import { signupOpen, peekInvite, setupTokenRequired } from "@/server/users";
import { AuthForm } from "../auth-form";
import { Email } from "@/components/email";
import { Brand } from "../brand";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; setup?: string }>;
}) {
  const { invite, setup } = await searchParams;
  // Looked at, not used up: the invite is spent only when the form posts
  // and the member is created (acceptInvite).
  const invited = invite ? await peekInvite(invite) : null;

  // A valid invite is its own permission: someone on the team sent it, so
  // the install's open-signup setting does not apply.
  if (invited) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-xl font-semibold text-fg">
            Join <span className="font-mono">{invited.tenant}</span>
          </h1>
          <p className="mb-6 text-sm text-fg-muted">
            You were invited as {invited.role}, with access to {invited.workspaces === null ? "every workspace" : invited.workspaces.length ? invited.workspaces.join(", ") : "no workspaces yet"}.{invited.email ? <> Sign up with <Email value={invited.email} /> — the invite is for that address, and works once.</> : " The link works once."}
          </p>
          <Suspense>
            <AuthForm mode="signup" invite={invite} />
          </Suspense>
        </div>
      </main>
    );
  }
  if (invite && !invited) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-fg">That invite is no longer valid</h1>
          <p className="text-sm text-fg-muted">Used, revoked or expired — ask your teammate for a fresh link. An invite works once, for seven days.</p>
        </div>
      </main>
    );
  }

  // The install's first account, where a setup token was set: the link the
  // installer printed carries it. Without it, say where to find it — never
  // whether a given token was close.
  if (!invited && (await setupTokenRequired()) && !setup) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-fg">Open your setup link</h1>
          <p className="text-sm text-fg-muted">
            This install&apos;s first account is created from the link the installer printed
            (<code className="rounded bg-muted px-1">/signup?setup=…</code>). It is also in the
            install&apos;s <code className="rounded bg-muted px-1">.env</code> as
            {" "}<code className="rounded bg-muted px-1">FOLDRUN_SETUP_TOKEN</code>.
          </p>
        </div>
      </main>
    );
  }

  if (!await signupOpen()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold text-fg">Signups are closed</h1>
          <p className="text-sm text-fg-muted">
            This install doesn&apos;t accept new accounts. If it&apos;s yours, start the server
            with <code className="rounded bg-muted px-1">FOLDRUN_OPEN_SIGNUP=1</code>.
          </p>
          <p className="mt-6 text-sm text-fg-muted">
            <Link href="/login" className="font-medium text-fg underline">
              Sign in instead
            </Link>
          </p>
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <Brand />
        <h1 className="mb-1 text-xl font-semibold text-fg">Create your account</h1>
        <p className="mb-6 text-sm text-fg-muted">
          A folder of markdown, running on a schedule, by tonight.
        </p>
        <Suspense>
          <AuthForm mode="signup" setup={setup} />
        </Suspense>
        <p className="mt-6 text-center text-sm text-fg-muted">
          Already have one?{" "}
          <Link href="/login" className="font-medium text-fg underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
