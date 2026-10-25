"use client";
// The second factor, from the person's own page. Enrol: a QR the app scans,
// one code to prove the app has it, eight backup codes shown once. Disable:
// the password and a code — a stolen session must not be enough to remove
// the thing that makes a stolen password not enough.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "@/components/ui";

export function MfaSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string; enrol: string } | null>(null);
  const [backup, setBackup] = useState<string[] | null>(null);
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
        <p className="font-medium text-fg">Two-factor authentication is on.</p>
        <p className="text-fg-tertiary">These backup codes each work once if you lose the app. This is the only time they are shown — keep them somewhere safe.</p>
        <pre className="rounded-lg bg-sunken p-3 font-mono text-sm leading-6 text-fg">{backup.join("\n")}</pre>
        <button className={buttonClass("primary")} onClick={() => { setBackup(null); router.refresh(); }}>I have saved them</button>
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
        <p className="text-fg-secondary">Two-factor authentication is <span className="font-medium text-emerald-700">on</span>. Every sign-in asks for a code from your app.</p>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-fg-secondary">Turn it off</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input name="password" type="password" required placeholder="your password" autoComplete="current-password" className={inputClass()} />
            <input name="code" required placeholder="code from the app, or a backup code" inputMode="numeric" className={inputClass()} />
          </div>
          {err && <p className="mt-2 text-red-700">{err}</p>}
          <button disabled={busy} className={`${buttonClass("secondary")} mt-3 !text-red-700`}>Turn off two-factor</button>
        </details>
      </form>
    );
  }

  if (setup) {
    return (
      <form className="space-y-3 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code") ?? "");
        const j = await post("/api/auth/mfa/enable", { enrol: setup.enrol, code });
        if (j) { setSetup(null); setBackup(j.backup as string[]); }
      }}>
        {/* The QR on the left; everything a person does on the right, in
            the order they do it: scan, or type the key; enter the code;
            confirm. One column of actions beside one picture. */}
        <div className="flex flex-wrap items-start gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={160} height={160} className="shrink-0 rounded-lg border border-line" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-fg-secondary">Scan this with your authenticator app, then enter the code it shows.</p>
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer">Can&apos;t scan? Enter the key by hand</summary>
              <code className="mt-1 block break-all rounded bg-sunken p-2 font-mono text-fg">{setup.secret}</code>
            </details>
            <input name="code" required autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className={inputClass("w-40 text-center tracking-widest")} />
            {err && <p className="text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button disabled={busy} className={buttonClass("primary")}>Turn on two-factor</button>
              <button type="button" className={buttonClass("secondary")} onClick={() => setSetup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-fg-secondary">Two-factor authentication is <span className="font-medium">off</span>. Turn it on and every sign-in needs a code from an authenticator app as well as your password.</p>
      {err && <p className="text-red-700">{err}</p>}
      <button disabled={busy} className={buttonClass("primary")} onClick={async () => { const j = await post("/api/auth/mfa/setup", {}); if (j) setSetup(j as { secret: string; qr: string; enrol: string }); }}>Set up two-factor</button>
    </div>
  );
}
