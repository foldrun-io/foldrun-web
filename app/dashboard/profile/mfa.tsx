"use client";
// The second factor, from the person's own page. Enrol: a QR the app scans,
// one code to prove the app has it, eight backup codes shown once. Disable:
// the password and a code — a stolen session must not be enough to remove
// the thing that makes a stolen password not enough.
import { $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { Disclosure } from "@foldrun/ui/react/disclosure";

export function MfaSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string; enrol: string } | null>(null);
  const [backup, setBackup] = useState<string[] | null>(null);
  const [ended, setEnded] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const post = async (url: string, body: unknown) => {
    setBusy(true); setErr(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? `HTTP ${res.status}`); return null; }
    return j;
  };

  if (backup) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-fg">{$t("profile.mfa.twoFactorAuthenticationIsOn2", { part: ended > 0 ? $t("profile.mfa.signedOut", { v0: String(ended === 1 ? $t("profile.mfa.oneOtherBrowserWas") : $t("profile.mfa.otherBrowsersWere", { ended: String(ended) })) }) : "" })}</p>
        <p className="text-fg-tertiary">{$t("profile.mfa.theseBackupCodesEachWorkOnce")}</p>
        <pre className="rounded-lg bg-sunken p-3 font-mono text-sm leading-6 text-fg">{backup.join("\n")}</pre>
        <button className={buttonVariants({ variant: "primary", size: "md" })} onClick={() => { setBackup(null); router.refresh(); }}>{$t("profile.mfa.iHaveSavedThem")}</button>
      </div>
    );
  }

  if (enabled) {
    return (
      <form className="space-y-3 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await post("/api/auth/mfa/disable", { password: f.get("password"), code: f.get("code") })) router.refresh();
      }}>
        <p className="text-fg-secondary">{$rich("profile.mfa.twoFactorAuthenticationIsOnEvery", { span: (chunks) => <span className="font-medium text-success">{chunks}</span> })}</p>
        <Disclosure className="rounded-lg border border-line p-3" summaryClassName="text-fg-secondary" summary={$t("profile.mfa.turnItOff")}>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input name="password" type="password" required placeholder={$t("profile.mfa.yourPassword")} autoComplete="current-password"  />
            <Input name="code" required placeholder={$t("profile.mfa.codeFromTheAppOrA")} inputMode="numeric"  />
          </div>
          {err && <p className="mt-2 text-danger">{err}</p>}
          <button disabled={busy} className={`${buttonVariants({ variant: "secondary", size: "md" })} mt-3 !text-danger`}>{$t("profile.mfa.turnOffTwoFactor")}</button>
        </Disclosure>
      </form>
    );
  }

  if (setup) {
    return (
      <form className="space-y-3 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code") ?? "");
        const j = await post("/api/auth/mfa/enable", { enrol: setup.enrol, code });
        if (j) { setSetup(null); setBackup(j.backup as string[]); setEnded(typeof j.otherSessionsEnded === "number" ? j.otherSessionsEnded : 0); }
      }}>
        {/* The QR on the left; everything a person does on the right, in
            the order they do it: scan, or type the key; enter the code;
            confirm. One column of actions beside one picture. */}
        <div className="flex flex-wrap items-start gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt={$t("profile.mfa.qrCodeForYourAuthenticatorApp")} width={160} height={160} className="shrink-0 rounded-lg border border-line" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-fg-secondary">{$t("profile.mfa.scanThisWithYourAuthenticatorApp")}</p>
            <Disclosure className="text-xs text-fg-muted" summary={$t("profile.mfa.canAposTScanEnterThe")}>
              <code className="mt-1 block break-all rounded bg-sunken p-2 font-mono text-fg">{setup.secret}</code>
            </Disclosure>
            <Input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder={$t("profile.mfa.6DigitCode")} className="w-40 text-center tracking-widest" />
            {err && <p className="text-danger">{err}</p>}
            <div className="flex gap-2">
              <button disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })}>{$t("profile.mfa.turnOnTwoFactor")}</button>
              <button type="button" className={buttonVariants({ variant: "secondary", size: "md" })} onClick={() => setSetup(null)}>{$t("profile.mfa.cancel")}</button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-fg-secondary">{$rich("profile.mfa.twoFactorAuthenticationIsOffTurn", { span: (chunks) => <span className="font-medium">{chunks}</span> })}</p>
      {err && <p className="text-danger">{err}</p>}
      <button disabled={busy} className={buttonVariants({ variant: "primary", size: "md" })} onClick={async () => { const j = await post("/api/auth/mfa/setup", {}); if (j) setSetup(j as { secret: string; qr: string; enrol: string }); }}>{$t("profile.mfa.setUpTwoFactor")}</button>
    </div>
  );
}
