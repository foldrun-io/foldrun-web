import { $el, $rich, $t } from "@/i18n";
import { Suspense } from "react";
import Link from "@foldrun/ui/react/link";
import { cookies } from "next/headers";
import { cn } from "@foldrun/ui/react/cn";
import { buttonVariants } from "@foldrun/ui/react/button";
import { findMember, findUser, hasUsers, inviteDoor, peekInvite, setupTokenRequired, verifySession, SESSION_COOKIE } from "@/server/users";
import { JoinAccount, SignOutHere } from "../join-account";
import { readSignupLink } from "@/server/signup-links";
import { signupModesNow, signupPageState, SIGNUP_CONTACT } from "@/server/signup";
import { platform } from "@/lib/platform";
import { AuthForm } from "../auth-form";
import { Email } from "@/components/email";
import { AuthCard } from "../brand";

import { requestLocale } from "@/server/locale";
export async function generateMetadata() {
  await requestLocale();
  return { title: $t("auth.signup-page.createAccount") };
}
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; setup?: string; link?: string }>;
}) {
  await requestLocale();
  const { invite, setup, link } = await searchParams;

  // A sign-up link the platform mailed to one address (server/signup-links.ts):
  // its own permission, like an invite, so the open-signup setting does not
  // apply. Read, not used: the account is made when the form posts.
  if (link !== undefined) {
    const linked = readSignupLink(link);
    if (!linked) {
      return (
        <AuthCard center title={$t("auth.signup-page.thatSignUpLinkIsNo")} hint={$t("auth.signup-page.itHasExpiredOrIsNot")} />
      );
    }
    if (await findUser(linked.email)) {
      return (
        <AuthCard
          center
          title={$t("auth.signup-page.thisAddressAlreadyHasAnAccount")}
          hint={
            <>
              {$rich("auth.signup-page.isAlreadySignedUpSignIn", { email: $el(<Email value={linked.email} />) })}
            </>
          }
          footer={
            <Link href="/login" className="font-medium text-fg hover:underline">
              {$t("auth.signup-page.signIn")}
            </Link>
          }
        />
      );
    }
    return (
      <AuthCard
        title={$t("auth.signup-page.createYourAccount")}
        hint={
          <>
            {$rich("auth.signup-page.forChooseAnAccountNameAnd", { email: $el(<Email value={linked.email} />) })}
          </>
        }
        footer={
          <>
            {$rich("auth.signup-page.alreadyHaveOneSignIn", { link: (chunks) => <Link href="/login" className="font-medium text-fg hover:underline">{chunks}</Link> })}
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
  // GET /v1/signup use (server/signup.ts).
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
    // The address already has a login (FOL-464): the form below would be
    // refused, so the page says where the person stands, and does not offer it.
    const door = await inviteDoor(invited);
    // Who is looking: a signed-in person joins with the login they have
    // (FOL-464), one login in several accounts.
    const me = await verifySession((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
    const account = <span className="font-mono">{invited.tenant}</span>;
    const invitedAs = $t("auth.signup-page.youWereInvitedAsWithAccess", { role: invited.role, part: invited.workspaces === null ? $t("auth.signup-page.everyWorkspace") : invited.workspaces.length ? invited.workspaces.join(", ") : $t("auth.signup-page.noWorkspaceYet") });
    const signInHere = `/login?next=${encodeURIComponent(`/signup?invite=${encodeURIComponent(invite!)}`)}`;
    if (me && !me.viewAs) {
      // Signed in with another address than the one invited: the link is not theirs to use.
      if (invited.email && invited.email !== me.email.toLowerCase()) {
        return (
          <AuthCard
            title={$t("auth.signup-page.thisInviteIsForAnotherAddress")}
            hint={<>{$rich("auth.signup-page.itWasSentToAndYouAre", { email: $el(<Email value={invited.email} />), me: $el(<Email value={me.email} />) })}</>}
          >
            <SignOutHere />
          </AuthCard>
        );
      }
      if (await findMember(invited.tenant, { id: me.id })) {
        return (
          <AuthCard
            title={<>{$rich("auth.signup-page.youAreAlreadyIn", { tenant: invited.tenant, span: () => account })}</>}
            hint={<>{$rich("auth.signup-page.youAreSignedInAs", { email: $el(<Email value={me.email} />) })}</>}
          >
            <JoinAccount from={me.tenant} as={me.id} account={invited.tenant} label={$t("auth.signup-page.open", { tenant: invited.tenant })} />
          </AuthCard>
        );
      }
      return (
        <AuthCard
          title={<>{$rich("auth.signup-page.join", { tenant: invited.tenant, span: () => account })}</>}
          hint={
            <>
              {invitedAs} {$rich("auth.signup-page.youAreSignedInAsJoin", { email: $el(<Email value={me.email} />) })}
            </>
          }
        >
          <JoinAccount from={me.tenant} as={me.id} invite={invite!} label={$t("auth.signup-page.joinButton", { tenant: invited.tenant })} />
        </AuthCard>
      );
    }
    // Not signed in, and the address already has a login: the form below
    // would be refused, so the page sends them to sign in and come back.
    if (door !== "signup" && invited.email) {
      return (
        <AuthCard
          title={<>{door === "member" ? $rich("auth.signup-page.youAreAlreadyIn", { tenant: invited.tenant, span: () => account }) : $rich("auth.signup-page.signInToJoin", { tenant: invited.tenant, span: () => account })}</>}
          hint={
            door === "member" ? (
              <>{$rich("auth.signup-page.isAlreadyAMemberSignIn", { email: $el(<Email value={invited.email} />) })}</>
            ) : (
              <>
                {$rich("auth.signup-page.alreadyHasALoginSignIn", { email: $el(<Email value={invited.email} />) })} {invitedAs}
              </>
            )
          }
        >
          <Link href={signInHere} className={cn(buttonVariants({ variant: "primary" }), "w-full")}>
            {$t("auth.signup-page.signIn")}
          </Link>
        </AuthCard>
      );
    }
    return (
      <AuthCard
        title={
          <>
            {$rich("auth.signup-page.join", { tenant: invited.tenant, span: (chunks) => <span className="font-mono">{chunks}</span> })}
          </>
        }
        hint={
          <>
            {$t("auth.signup-page.youWereInvitedAsWithAccess", { role: invited.role, part: invited.workspaces === null ? $t("auth.signup-page.everyWorkspace") : invited.workspaces.length ? invited.workspaces.join(", ") : $t("auth.signup-page.noWorkspaceYet") })}
            {invited.email ? (
              <>
                {" "}{$rich("auth.signup-page.signUpWithTheInviteIs", { email: $el(<Email value={invited.email} />) })}
              </>
            ) : (
              $t("auth.signup-page.theLinkWorksOnce")
            )}
          </>
        }
        footer={<>{$rich("auth.signup-page.alreadyHaveALoginSignInToJoin", { link: (chunks) => <Link href={signInHere} className="font-medium text-fg hover:underline">{chunks}</Link> })}</>}
      >
        <Suspense>
          <AuthForm mode="signup" invite={invite} {...(invited.email ? { inviteEmail: invited.email } : {})} />
        </Suspense>
      </AuthCard>
    );
  }
  if (state === "invite-invalid") {
    return (
      <AuthCard center title={$t("auth.signup-page.thatInviteIsNoLongerValid")} hint={$t("auth.signup-page.usedRevokedOrExpiredAskYour")} />
    );
  }

  // The install's first account, where a setup token was set: the link the
  // installer printed carries it. Without it, say where to find it — never
  // whether a given token was close.
  if (state === "setup") {
    return (
      <AuthCard
        center
        title={$t("auth.signup-page.openYourSetupLink")}
        hint={
          <>
            {$rich("auth.signup-page.thisInstallSEnvAsFoldrun", { code: (chunks) => <code className="rounded bg-muted px-1">{chunks}</code> })}
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
        title={$t("auth.signup-page.newAccountRegistrationIsClosed")}
        hint={
          platform.edition() === "hosted" ? (
            <>
              {$rich("auth.signup-page.contactToAskForAnAccount", { email: $el(<Email value={SIGNUP_CONTACT} />) })}
            </>
          ) : (
            <>
              {$rich("auth.signup-page.thisInstallDoesnSYoursStart", { code: (chunks) => <code className="rounded bg-muted px-1">{chunks}</code> })}
            </>
          )
        }
        footer={
          <>
            {$rich("auth.signup-page.alreadyHaveAnAccountSignIn", { link: (chunks) => <Link href="/login" className="font-medium text-fg hover:underline">{chunks}</Link> })}
          </>
        }
      />
    );
  }
  return (
    <AuthCard
      title={$t("auth.signup-page.createYourAccount")}
      hint={$t("auth.signup-page.aFolderOfMarkdownRunningOn")}
      footer={
        <>
          {$rich("auth.signup-page.alreadyHaveOneSignIn", { link: (chunks) => <Link href="/login" className="font-medium text-fg hover:underline">{chunks}</Link> })}
        </>
      }
    >
      <Suspense>
        <AuthForm mode="signup" setup={setup} />
      </Suspense>
    </AuthCard>
  );
}
