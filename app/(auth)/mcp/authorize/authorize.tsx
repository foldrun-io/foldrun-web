"use client";

import { $el, $rich, $t } from "@/i18n";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Email } from "@/components/email";
import { Checkbox, RadioGroup, RadioGroupItem } from "@foldrun/ui/react/choice";

type Ask = {
  client: { name: string; id: string; kind: "dcr" | "cimd"; uri: string | null };
  redirectHost: string;
  loopback: boolean;
  scopes: string[];
  account: string;
  person: { email: string; role: string };
  workspaces: string[];
  allWorkspaces: boolean;
};

export function McpAuthorize() {
  const params = useSearchParams();
  const request = params.toString();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<"read" | "write">("write");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json() as Promise<{ user: unknown }>)
      .then(async (s) => {
        if (!s.user) {
          window.location.assign(`/login?next=${encodeURIComponent(`/mcp/authorize?${request}`)}`);
          return;
        }
        const res = await fetch(`/api/mcp/oauth/authorize?request=${encodeURIComponent(request)}`);
        const body = (await res.json().catch(() => ({}))) as Ask & { error?: string; redirect?: string };
        if (body.redirect) {
          window.location.assign(body.redirect);
          return;
        }
        if (!res.ok) {
          setError(body.error ?? $t("auth.mcp-authorize-authorize.thisSignInRequestCannotBe"));
          return;
        }
        setAsk(body);
        if (!body.scopes.includes("mcp:write")) setAccess("read");
      })
      .catch(() => setError($t("auth.mcp-authorize-authorize.couldNotReachTheServer")));
  }, [request]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, decision, access, workspaces: scope === "all" ? null : chosen }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; redirect?: string };
      if (body.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setError(body.error ?? $t("auth.mcp-authorize-authorize.somethingWentWrong"));
    } catch (err) {
      setError($t("auth.mcp-authorize-authorize.couldNotReachTheServer2", { v0: String(err instanceof Error ? err.message : String(err)) }));
    }
    setBusy(false);
  }

  if (error) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">{$t("auth.mcp-authorize-authorize.thisAppCannotConnect")}</h1>
        <p className="text-sm text-fg-tertiary">{error}</p>
      </>
    );
  }
  if (!ask) return <p className="text-sm text-fg-muted">…</p>;

  const canWrite = ask.scopes.includes("mcp:write");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-fg">{$t("auth.mcp-authorize-authorize.connect", { name: ask.client.name })}</h1>
      <p className="mb-5 text-sm text-fg-muted">
        {$rich("auth.mcp-authorize-authorize.itAsksToUseFoldrunAccount", { account: ask.account, span: (chunks) => <span className="font-mono">{chunks}</span> })}{" "}
        <span className="font-medium"><Email value={ask.person.email} /></span>{" "}{$t("auth.mcp-authorize-authorize.yourInboxRunsFlowsAndFiles", { role: ask.person.role, part: canWrite ? $t("auth.mcp-authorize-authorize.andIfYouAllowItTo") : "" })}
      </p>

      <div className="mb-4 rounded-md border border-line bg-sunken p-3 text-sm">
        <p className="text-fg-secondary">
          {$rich("auth.mcp-authorize-authorize.yourAnswerGoesTo", { redirectHost: ask.redirectHost, span: (chunks) => <span className="font-mono font-medium">{chunks}</span> })}
          {ask.client.kind === "cimd" ? <>{" "}{$rich("auth.mcp-authorize-authorize.describedAt", { host: new URL(ask.client.id).host, span: (chunks) => <span className="font-mono">{chunks}</span> })}</> : null}
        </p>
        {ask.loopback && (
          <p className="mt-1 text-xs text-warning">
            {$t("auth.mcp-authorize-authorize.thatIsAnAppOnThis")}
          </p>
        )}
      </div>

      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium text-fg-secondary">{$t("auth.mcp-authorize-authorize.whatItMayDo")}</legend>
        <RadioGroup value={access} onValueChange={(v) => setAccess(v as typeof access)} className="gap-1">
        <label className="flex items-center gap-2 text-sm">
          {$rich("auth.mcp-authorize-authorize.readOnlyInboxRunsFlowsFiles", { radioGroupItem: $el(<RadioGroupItem value="read" />) })}
        </label>
        <label className={`flex items-center gap-2 text-sm ${canWrite ? "" : "opacity-50"}`}>
          {$rich("auth.mcp-authorize-authorize.readAndActAlsoStartStop2", { radioGroupItem: $el(<RadioGroupItem value="write" disabled={!canWrite} />) })}
        </label>
        </RadioGroup>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-1 text-sm font-medium text-fg-secondary">{$t("auth.mcp-authorize-authorize.whichWorkspace")}</legend>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as typeof scope)} className="gap-1">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="all" /> {ask.allWorkspaces ? $t("auth.mcp-authorize-authorize.allOfThemAndNewOnes") : $t("auth.mcp-authorize-authorize.allYouMayOpen")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          {$rich("auth.mcp-authorize-authorize.onlyThese", { radioGroupItem: $el(<RadioGroupItem value="some" />) })}
        </label>
        </RadioGroup>
        {scope === "some" && (
          <div className="ml-6 mt-1 space-y-1">
            {ask.workspaces.map((w) => (
              <label key={w} className="flex items-center gap-2 font-mono text-xs">
                <Checkbox
                  checked={chosen.includes(w)}
                  onCheckedChange={(checked: boolean) => setChosen(checked ? [...chosen, w] : chosen.filter((x) => x !== w))}
                />
                {w}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex gap-2">
        <button type="button" disabled={busy || (scope === "some" && !chosen.length)} onClick={() => decide("approve")} className={buttonVariants({ variant: "primary" })}>
          {$t("auth.mcp-authorize-authorize.connect2")}
        </button>
        <button type="button" disabled={busy} onClick={() => decide("deny")} className={buttonVariants({ variant: "secondary" })}>
          {$t("auth.mcp-authorize-authorize.deny")}
        </button>
      </div>
      <p className="mt-4 text-xs text-fg-muted">
        {$t("auth.mcp-authorize-authorize.itCanNeverDoMoreThan")}
      </p>
    </>
  );
}
