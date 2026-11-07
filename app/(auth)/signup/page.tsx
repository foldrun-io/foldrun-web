import { Suspense } from "react";
import Link from "@/components/kit/link";
import { signupOpen, peekInvite, setupTokenRequired } from "@/server/users";
import { AuthForm } from "../auth-form";
import { Email } from "@/components/email";
import { AuthCard } from "../brand";

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
      <AuthCard
        title={
          <>
            Join <span className="font-mono">{invited.tenant}</span>
          </>
        }
        hint={
          <>
            You were invited as {invited.role}, with access to {invited.workspaces === null ? "every workspace" : invited.workspaces.length ? invited.workspaces.join(", ") : "no workspaces yet"}.
            {invited.email ? (
              <>
                {" "}
                Sign up with <Email value={invited.email} /> — the invite is for that address, and works once.
              </>
            ) : (
              " The link works once."
            )}
          </>
        }
      >
        <Suspense>
          <AuthForm mode="signup" invite={invite} />
        </Suspense>
      </AuthCard>
    );
  }
  if (invite && !invited) {
    return (
      <AuthCard center title="That invite is no longer valid" hint="Used, revoked or expired — ask your teammate for a fresh link. An invite works once, for seven days." />
    );
  }

  // The install's first account, where a setup token was set: the link the
  // installer printed carries it. Without it, say where to find it — never
  // whether a given token was close.
  if (!invited && (await setupTokenRequired()) && !setup) {
    return (
      <AuthCard
        center
        title="Open your setup link"
        hint={
          <>
            This install&apos;s first account is created from the link the installer printed (<code className="rounded bg-muted px-1">/signup?setup=…</code>). It is also in the install&apos;s{" "}
            <code className="rounded bg-muted px-1">.env</code> as <code className="rounded bg-muted px-1">FOLDRUN_SETUP_TOKEN</code>.
          </>
        }
      />
    );
  }

  if (!await signupOpen()) {
    return (
      <AuthCard
        center
        title="Signups are closed"
        hint={
          <>
            This install doesn&apos;t accept new accounts. If it&apos;s yours, start the server with <code className="rounded bg-muted px-1">FOLDRUN_OPEN_SIGNUP=1</code>.
          </>
        }
        footer={
          <Link href="/login" className="font-medium text-fg hover:underline">
            Sign in instead
          </Link>
        }
      />
    );
  }
  return (
    <AuthCard
      title="Create your account"
      hint="A folder of markdown, running on a schedule, by tonight."
      footer={
        <>
          Already have one?{" "}
          <Link href="/login" className="font-medium text-fg hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <Suspense>
        <AuthForm mode="signup" setup={setup} />
      </Suspense>
    </AuthCard>
  );
}
