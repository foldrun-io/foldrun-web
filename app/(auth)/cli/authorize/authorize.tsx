"use client";

import { $rich, $t, $el } from "@/i18n";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Input } from "@foldrun/ui/react/input";
import { LocalTime } from "@/components/local-time";
import { Field, Callout } from "@foldrun/ui/react/page";

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
      .catch(() => setError($t("auth.cli-authorize-authorize.couldNotReachTheServer")));
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
      if (!res.ok) setError(body.error ?? $t("auth.cli-authorize-authorize.somethingWentWrong"));
      else setDone(decision === "approve" ? "approved" : "denied");
    } catch (err) {
      setError($t("auth.cli-authorize-authorize.couldNotReachTheServer2", { v0: String(err instanceof Error ? err.message : String(err)) }));
    }
    setBusy(false);
  }

  if (!me) return <p className="text-sm text-fg-muted">…</p>;

  if (done === "approved") {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">{$t("auth.cli-authorize-authorize.signedIn")}</h1>
        <p className="text-sm text-fg-tertiary">
          {$rich("auth.cli-authorize-authorize.yourTerminalOnIsSignedIn", { hostname: request?.hostname ?? "", span: (chunks) => <span className="font-mono">{chunks}</span>, email: me.email, span2: (chunks) => <span className="font-medium">{chunks}</span> })}
        </p>
        <p className="mt-4 text-xs text-fg-muted">
          {$t("auth.cli-authorize-authorize.theKeyItHoldsIsOn")}
        </p>
      </>
    );
  }
  if (done === "denied") {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">{$t("auth.cli-authorize-authorize.denied")}</h1>
        <p className="text-sm text-fg-tertiary">{$t("auth.cli-authorize-authorize.theTerminalWasToldNoNothing")}</p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-fg">{$t("auth.cli-authorize-authorize.signInTheCli")}</h1>
      <p className="mb-6 text-sm text-fg-muted">
        {$rich("auth.cli-authorize-authorize.aTerminalRanFoldrunLoginAnd", { span: (chunks) => <span className="font-mono">{chunks}</span> })}
      </p>

      <Field label={$t("auth.cli-authorize-authorize.codeShownInTheTerminal")}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-1234"
          autoFocus
          className="font-mono tracking-widest"
        />
      </Field>

      {request === null && code.replace(/[^A-Za-z0-9]/g, "").length === 8 && (
        <p className="mt-3 text-sm text-danger">{$rich("auth.cli-authorize-authorize.noSignInRequestHasThat", { span: (chunks) => <span className="font-mono">{chunks}</span> })}</p>
      )}

      {request && (
        <div className="mt-5 rounded-md border border-line bg-sunken p-4 text-sm">
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.machine")}</dt><dd className="font-mono text-fg">{request.hostname}</dd></div>
            {request.createdAt && <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.askedAt")}</dt><dd className="text-fg"><LocalTime iso={request.createdAt} options={CLOCK} />{request.approveBy ? <span className="text-fg-muted">{" "}{$rich("auth.cli-authorize-authorize.canBeApprovedUntil", { localTime: $el(<LocalTime iso={request.approveBy} options={CLOCK} />) })}</span> : null}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.askedFrom")}</dt><dd className="font-mono text-fg">{request.requestedFrom ? `${request.requestedFrom}${request.requestedCountry ? ` (${request.requestedCountry})` : ""}` : <span className="font-sans text-fg-muted">{$t("auth.cli-authorize-authorize.notKnown")}</span>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.signsInAs")}</dt><dd className="text-fg">{me.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.account")}</dt><dd className="text-fg">{me.tenant}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-fg-muted">{$t("auth.cli-authorize-authorize.role")}</dt><dd className="text-fg">{me.role === "owner" ? $t("auth.cli-authorize-authorize.adminAKeyIsNeverAn") : me.role}</dd></div>
          </dl>
          {request.sameNetwork === false && (
            <Callout tone="danger" className="mt-3 p-2 text-xs">
              {$rich("auth.cli-authorize-authorize.thisRequestCameFromADifferent", { span: (chunks) => <span className="font-mono">{chunks}</span> })}
            </Callout>
          )}
          <p className="mt-3 text-xs text-fg-muted">
            {$rich("auth.cli-authorize-authorize.approvingCreatesAnApiKeyFor", { span: (chunks) => <span className="font-mono">{chunks}</span> })}
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonVariants({ variant: "primary", size: "md" })}>
              {busy ? "…" : $t("auth.cli-authorize-authorize.yesThatSMe")}
            </button>
            <button type="button" disabled={busy} onClick={() => decide("deny")} className={buttonVariants({ variant: "secondary", size: "md" })}>
              {$t("auth.cli-authorize-authorize.deny")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </>
  );
}
