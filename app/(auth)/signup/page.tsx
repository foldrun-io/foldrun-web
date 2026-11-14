import { Suspense } from "react";
import Link from "@foldrun/ui/react/link";
import { findUser, hasUsers, peekInvite, setupTokenRequired } from "@/server/users";
import { readSignupLink } from "@/server/signup-links";
import { signupModesNow, signupPageState, SIGNUP_CONTACT } from "@/server/signup";
import { platform } from "@/lib/platform";
import { AuthForm } from "../auth-form";
import { Email } from "@/components/email";
import { AuthCard } from "../brand";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; setup?: string; link?: string }>;
}) {
  const { invite, setup, link } = await searchParams;

  // A sign-up link the platform mailed to one address (server/signup-links.ts):
  // its own permission, like an invite, so the open-signup setting does not
  // apply. Read, not used: the account is made when the form posts.
  if (link !== undefined) {
    const linked = readSignupLink(link);
    if (!linked) {
      return (
        <AuthCard center title="That sign-up link is no longer valid" hint="It has expired or is not complete. Ask for a new one where you got it — a link works for seven days." />
      );
    }
    if (await findUser(linked.email)) {
      return (
        <AuthCard
          center
          title="This address already has an account"
          hint={
            <>
              <Email value={linked.email} /> is already signed up. Sign in with it instead.
            </>
          }
          footer={
            <Link href="/login" className="font-medium text-fg hover:underline">
              Sign in
            </Link>
          }
        />
      );
    }
    return (
      <AuthCard
        title="Create your account"
        hint={
          <>
            For <Email value={linked.email} />. Choose an account name and a password.
          </>
        }
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
          <AuthForm mode="signup" link={{ token: link, email: linked.email }} />
        </Suspense>
      </AuthCard>
    );
  }
  // Looked at, not used up: the invite is spent only when the form posts
  // and the member is created (acceptInvite).
  const invited = invite ? await peekInvite(invite) : null;
  // The doors as this server runs them — the same resolver the POST and
  // GET /api/signup use (server/signup.ts).
  const state = signupPageState({
    inviteGiven: Boolean(invite),
    inviteValid: Boolean(invited),
    setupRequired: !invited && (await setupTokenRequired()),
    setupGiven: Boolean(setup),
    modes: signupModesNow(await hasUsers()),
  });

  // A valid invite is its own permission: someone on the team sent it, so
  // the install's open-signup setting does not apply.
  if (state === "invite" && invited) {
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
  if (state === "invite-invalid") {
    return (
      <AuthCard center title="That invite is no longer valid" hint="Used, revoked or expired — ask your teammate for a fresh link. An invite works once, for seven days." />
    );
  }

  // The install's first account, where a setup token was set: the link the
  // installer printed carries it. Without it, say where to find it — never
  // whether a given token was close.
  if (state === "setup") {
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

  // Neither the first account nor free sign-up: registration is closed. No
  // waitlist — a person who wants in writes to us (hosted) or asks whoever
  // runs the install. Signing in, and a valid invite, still work.
  if (state === "closed") {
    return (
      <AuthCard
        center
        title="New account registration is closed"
        hint={
          platform.edition() === "hosted" ? (
            <>
              Contact <Email value={SIGNUP_CONTACT} /> to ask for an account. If a teammate invited you, open the link they sent.
            </>
          ) : (
            <>
              This install doesn&apos;t accept new accounts — ask whoever runs it for an invite. If it&apos;s yours, start the server with <code className="rounded bg-muted px-1">FOLDRUN_OPEN_SIGNUP=1</code>.
            </>
          )
        }
        footer={
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-fg hover:underline">
              Sign in
            </Link>
          </>
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
