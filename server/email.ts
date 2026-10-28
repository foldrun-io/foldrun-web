// Mail the platform sends on a person's behalf: invites, resets, login
// changes. Through platformMail — the account's own sender when it set one
// (RESEND_API_KEY + EMAIL_FROM), the platform's otherwise.

import { platformMail } from "@/lib/notify";
import { sendMail, type MailCategory } from "@/lib/mail";

export async function sendInviteEmail(
  tenant: string,
  to: string,
  url: string,
  detail: { from: string; role: string; scope: string; expires: Date },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = platformMail(tenant);
  if (!mail) return { ok: false, error: "the platform has no mail credential (FOLDRUN_RESEND_API_KEY) — copy the link instead" };
  const res = await sendMail({
    tenant,
    mail,
    to,
    category: "invites",
    subject: `${detail.from} invited you to ${tenant} on foldrun`,
    text:
      `${detail.from} invited you to join the account "${tenant}" on foldrun as ${detail.role}, with access to ${detail.scope}.\n\n` +
      `Accept the invite here (it is for this address only, and expires ${detail.expires.toDateString()}):\n${url}\n\n` +
      `If you were not expecting this, ignore it — nothing happens until you accept.\n`,
  });
  if (!res.ok) return { ok: false, error: res.status ? `the mail service refused it (HTTP ${res.status})` : res.error ?? "not sent" };
  return { ok: true };
}

/** Everything here goes through core's sendMail with its category — all of
 *  them required ones (security, account), so none can be turned off and
 *  none carries an unsubscribe. */
async function platformSend(
  tenant: string,
  to: string,
  subject: string,
  text: string,
  html?: string,
  category: MailCategory = "security",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = platformMail(tenant);
  if (!mail) return { ok: false, error: "the platform has no mail credential (FOLDRUN_RESEND_API_KEY)" };
  const res = await sendMail({ tenant, mail, to, subject, text, html, category });
  if (!res.ok) return { ok: false, error: res.status ? `the mail service refused it (HTTP ${res.status})` : res.error ?? "not sent" };
  return { ok: true };
}

/** The reset link. Says who asked and from where, because the person
 *  reading it may not have — and then the one thing to do is nothing. */
export function sendResetEmail(tenant: string, to: string, url: string, ip: string | null) {
  return platformSend(tenant, to, "Reset your foldrun password",
    `Someone — hopefully you — asked to reset the password for ${to}${ip ? ` (from ${ip})` : ""}.\n\n` +
    `Set a new one here. The link works once and for 30 minutes:\n${url}\n\n` +
    `If you did not ask, ignore this: your password has not changed and nobody can change it without this link.\n`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One layout for every link we mail.
 *
 * These were text-only, which meant a signed verification token — two
 * hundred characters of base64 — was printed as the visible link, wrapping
 * across two lines. It read like a phishing attempt, which is the opposite
 * of what a "prove this address is yours" mail needs to read like. The
 * button carries the URL; the same URL is repeated small underneath,
 * because a mail client that blocks HTML still has to be usable.
 */
function linkEmail(opts: { lead: string; button: string; url: string; after: string }): string {
  const u = esc(opts.url);
  return `<div style="margin:0;padding:24px;background:#f8f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e8e8e6;border-radius:12px;padding:28px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#1a1a19">${opts.lead}</p>
    <a href="${u}" style="display:inline-block;padding:11px 20px;background:#1a1a19;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;border-radius:8px">${esc(opts.button)}</a>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:#6b6b68">${opts.after}</p>
    <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #eeeeec;font-size:11px;line-height:1.5;color:#9a9a96">
      If the button does not work, paste this into your browser:<br>
      <span style="word-break:break-all;color:#9a9a96">${u}</span>
    </p>
  </div>
</div>`;
}

/**
 * `trialCredits` is passed only when this person's confirmation actually
 * grants them — the owner of a new account, on the hosted platform. A
 * joiner's team already has a wallet and gets nothing, so promising them
 * credits would be a lie told at the least forgivable moment: the first
 * email we ever send them.
 */
export function sendVerifyEmail(tenant: string, to: string, url: string, opts?: { trialCredits?: number }) {
  const trial = opts?.trialCredits;
  // What clicking DOES, rather than what it enables later. The old copy said
  // it "lets you reset your password later and receive notifications" —
  // true, dull, and not the reason: confirming is what turns the account on.
  const why = trial
    ? `Confirming turns on your account and puts ${trial} free credits in it — enough to run a desk for a few days. No card needed.`
    : `Confirming turns on your account, so you can be sent run notifications and reset your password later.`;
  return platformSend(
    tenant,
    to,
    "Confirm your email for foldrun",
    `Confirm that ${to} is yours:\n${url}\n\n${why}\n\nThe link is good for 24 hours.\n`,
    linkEmail({
      lead: `Confirm that <strong>${esc(to)}</strong> is yours.`,
      button: "Confirm this address",
      url,
      after: `${esc(why)} The link is good for 24 hours.`,
    }),
  );
}

/** A new account, made for someone by the super admin. No password in the
 *  mail, ever — a set-password link that works once. */
export function sendAccountCreatedEmail(tenant: string, to: string, url: string) {
  return platformSend(tenant, to, `Your foldrun account "${tenant}" is ready`,
    `An account named "${tenant}" was created for ${to} on foldrun.\n\n` +
    `Choose your password here (the link works once, for 30 minutes):\n${url}\n\n` +
    `If you were not expecting this, reply to this email.\n`);
}

/** To the OLD address, after a change: the one person who must hear that a
 *  login moved is the one who no longer gets mail at where it moved to. No
 *  link — there is nothing for them to click; if it was not them, they
 *  reply and a human reverses it. */
export function sendEmailChangedNotice(tenant: string, oldAddress: string, newAddress: string) {
  return platformSend(tenant, oldAddress, "Your foldrun login address was changed",
    `The login for your foldrun account "${tenant}" was just changed from ${oldAddress} to ${newAddress}.\n\n` +
    `If that was you, there is nothing to do — confirm the new address from the mail sent there.\n\n` +
    `If it was not you, reply to this email straight away and we will reverse it.\n`);
}

/** To the super admin: an owner asked to close their account. The account
 *  is already suspended by the time this is sent; what is left is human —
 *  the last invoice, any refund, and when the data goes. */
export function sendCloseRequestNotice(platformTenant: string, to: string, account: string, by: string, reason: string) {
  return platformSend(platformTenant, to, `Close request: "${account}"`,
    `${by}, the owner of "${account}", asked for the account to be closed.\n\n` +
    `Reason given: ${reason || "(none)"}\n\n` +
    `The account is suspended now: no new runs, and people can still sign in to read and export their data. ` +
    `Nothing has been deleted. Settle the last invoice and any refund, then decide when the data goes.\n`, undefined, "account");
}

/** To the super admin: a customer asked for a restore from a backup — the
 *  runs, state, storage or database records they cannot restore themselves.
 *  Everything needed to find the archive and scope the restore is in the
 *  mail; the request is also a row (restore_requests) and an audit entry. */
export function sendRestoreRequestNotice(
  platformTenant: string,
  to: string,
  r: { id: string; tenant: string; workspace: string | null; what: string; target: string; backupId: string | null; note: string | null; by: string; at: string },
) {
  return platformSend(platformTenant, to, `Restore request: "${r.tenant}"${r.workspace ? ` / ${r.workspace}` : ""} (${r.what})`,
    `${r.by} asked for a restore from backup.\n\n` +
    `Account:   ${r.tenant}\n` +
    `Workspace: ${r.workspace ?? "(all of them)"}\n` +
    `What:      ${r.what}\n` +
    `To:        ${r.target}\n` +
    `Archive:   ${r.backupId ?? "(not chosen — the nearest before that time)"}\n` +
    `Asked at:  ${r.at}\n` +
    `Request:   ${r.id}\n\n` +
    `Note: ${r.note || "(none)"}\n\n` +
    `Nothing has been restored. The runbook is foldrun-infra dev/README.md, "Restore"; restore into a scratch volume and copy back only this account's paths.\n`, undefined, "account");
}

/**
 * "Your sign-in changed" — after a password change or reset, the second
 * factor turned on or off, or a new API key. The person learns of it even
 * when it was not them, which is the point (ASVS 2.2.3). Never awaited by a
 * route: a mail outage must not fail the change it reports.
 */
export function sendSecurityNotice(tenant: string, to: string, what: string, ip: string | null): void {
  void platformSend(tenant, to, `foldrun: ${what}`,
    `${what[0].toUpperCase()}${what.slice(1)} on the foldrun account ${to}${ip ? ` (from ${ip})` : ""}, at ${new Date().toUTCString()}.\n\n` +
    `If this was you, there is nothing to do.\n` +
    `If it was not, reset your password now from the sign-in page ("Forgot password"), then check Profile → Sessions and Settings → API keys.\n`)
    .catch((err) => console.error("security notice failed:", err instanceof Error ? err.message : err));
}
