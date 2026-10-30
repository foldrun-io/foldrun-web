"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClass, inputClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

type Request = {
  code: string;
  hostname: string;
  expiresAt: string;
  status: string;
  /** When the terminal asked, from where (an IPv4 /24 or IPv6 /48, and a
   *  country behind Cloudflare; null when not known), whether this browser
   *  is on that network, and until when it can be approved (30 Oct 2026). */
  createdAt?: string;
  requestedFrom?: string | null;
  requestedCountry?: string | null;
  sameNetwork?: boolean | null;
  approveBy?: string;
};

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
type Me = { user: { email: string; tenant: string; role: string } | null };

export function CliAuthorize() {
  const fromUrl = useSearchParams().get("code") ?? "";
  // Never filled in from the link: typing the code the terminal shows is the
  // proof that the terminal is yours. A link with the code in it can be sent
  // by anyone who ran `foldrun login` themselves (device-code phishing).
  const [code, setCode] = useState("");
  const [me, setMe] = useState<Me["user"] | undefined>(undefined);
  const [request, setRequest] = useState<Request | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in? Otherwise the login page, and back here with the code kept.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json() as Promise<Me>)
      .then((s) => {
        if (s.user) setMe(s.user);
        else window.location.assign(`/login?next=${encodeURIComponent(`/cli/authorize?code=${fromUrl}`)}`);
      })
      .catch(() => setError("could not reach the server"));
  }, [fromUrl]);

  // What is asking, once there is a code to look up.
  useEffect(() => {
    if (!code || code.replace(/[^A-Za-z0-9]/g, "").length !== 8) {
      setRequest(null);
      return;
    }
    fetch(`/api/cli/authorize?code=${encodeURIComponent(code)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Request) : null))
      .then(setRequest)
      .catch(() => setRequest(null));
  }, [code]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cli/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, decision }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) setError(body.error ?? "something went wrong");
      else setDone(decision === "approve" ? "approved" : "denied");
    } catch (err) {
      setError(`could not reach the server: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  }

  if (!me) return <p className="text-sm text-fg-muted">…</p>;

  if (done === "approved") {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">Signed in</h1>
        <p className="text-sm text-fg-tertiary">
          Your terminal on <span className="font-mono">{request?.hostname}</span> is signed in as{" "}
          <span className="font-medium">{me.email}</span>. You can close this tab.
        </p>
        <p className="mt-4 text-xs text-fg-muted">
          The key it holds is on Settings → API keys, labelled with the machine. Revoke it there to sign that machine out.
        </p>
      </>
    );
  }
  if (done === "denied") {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">Denied</h1>
        <p className="text-sm text-fg-tertiary">The terminal was told no. Nothing was created.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-fg">Sign in the CLI</h1>
      <p className="mb-6 text-sm text-fg-muted">
        A terminal ran <span className="font-mono">foldrun login</span> and is waiting for you to say it is yours.
      </p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-fg-secondary">Code shown in the terminal</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-1234"
          autoFocus
          className={inputClass("font-mono tracking-widest")}
        />
      </label>

      {request === null && code.replace(/[^A-Za-z0-9]/g, "").length === 8 && (
        <p className="mt-3 text-sm text-red-600">No sign-in request has that code. It may have expired — run <span className="font-mono">foldrun login</span> again.</p>
      )}

      {request && (
        <div className="mt-5 rounded-md border border-line bg-surface p-4 text-sm">
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">Machine</dt><dd className="font-mono text-fg">{request.hostname}</dd></div>
            {request.createdAt && <div className="flex justify-between gap-4"><dt className="text-fg-muted">Asked at</dt><dd className="text-fg"><LocalTime iso={request.createdAt} options={CLOCK} />{request.approveBy ? <span className="text-fg-muted"> — can be approved until <LocalTime iso={request.approveBy} options={CLOCK} /></span> : null}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">Asked from</dt><dd className="font-mono text-fg">{request.requestedFrom ? `${request.requestedFrom}${request.requestedCountry ? ` (${request.requestedCountry})` : ""}` : <span className="font-sans text-fg-muted">not known</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">Signs in as</dt><dd className="text-fg">{me.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">Account</dt><dd className="text-fg">{me.tenant}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">Role</dt><dd className="text-fg">{me.role === "owner" ? "admin (a key is never an owner)" : me.role}</dd></div>
          </dl>
          {request.sameNetwork === false && (
            <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700">
              This request came from a different network than the one this browser is on. If you did not just run <span className="font-mono">foldrun login</span> on another machine of your own, deny it.
            </p>
          )}
          <p className="mt-3 text-xs text-fg-muted">
            Approving creates an API key for that machine at your role. The machine name is whatever that terminal said — it proves nothing.
            Approve only if you ran <span className="font-mono">foldrun login</span> yourself just now and your own terminal shows this code.
            If someone sent you this link, deny it.
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonClass("primary")}>
              {busy ? "…" : "Yes, that's me"}
            </button>
            <button type="button" disabled={busy} onClick={() => decide("deny")} className={buttonClass("secondary")}>
              Deny
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </>
  );
}
