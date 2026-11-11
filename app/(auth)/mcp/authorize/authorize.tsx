"use client";

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
          setError(body.error ?? "this sign-in request cannot be used");
          return;
        }
        setAsk(body);
        if (!body.scopes.includes("mcp:write")) setAccess("read");
      })
      .catch(() => setError("could not reach the server"));
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
      setError(body.error ?? "something went wrong");
    } catch (err) {
      setError(`could not reach the server: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  }

  if (error) {
    return (
      <>
        <h1 className="mb-1 text-xl font-semibold text-fg">This app cannot connect</h1>
        <p className="text-sm text-fg-tertiary">{error}</p>
      </>
    );
  }
  if (!ask) return <p className="text-sm text-fg-muted">…</p>;

  const canWrite = ask.scopes.includes("mcp:write");
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-fg">Connect {ask.client.name}?</h1>
      <p className="mb-5 text-sm text-fg-muted">
        It asks to use foldrun account <span className="font-mono">{ask.account}</span> as{" "}
        <span className="font-medium"><Email value={ask.person.email} /></span> ({ask.person.role}): your inbox, runs, flows and files
        {canWrite ? ", and — if you allow it — to start and stop runs, approve gates, answer agents, and create workspaces and change their files" : ""}.
      </p>

      <div className="mb-4 rounded-md border border-line bg-sunken p-3 text-sm">
        <p className="text-fg-secondary">
          Your answer goes to <span className="font-mono font-medium">{ask.redirectHost}</span>
          {ask.client.kind === "cimd" ? <> · described at <span className="font-mono">{new URL(ask.client.id).host}</span></> : null}
        </p>
        {ask.loopback && (
          <p className="mt-1 text-xs text-warning">
            That is an app on this computer. Approve only if you just started it yourself.
          </p>
        )}
      </div>

      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium text-fg-secondary">What it may do</legend>
        <RadioGroup value={access} onValueChange={(v) => setAccess(v as typeof access)} className="gap-1">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="read" /> Read only — inbox, runs, flows, files
        </label>
        <label className={`flex items-center gap-2 text-sm ${canWrite ? "" : "opacity-50"}`}>
          <RadioGroupItem value="write" disabled={!canWrite} /> Read and act — also start, stop, approve, answer, message, and edit workspaces
        </label>
        </RadioGroup>
      </fieldset>

      <fieldset className="mb-6">
        <legend className="mb-1 text-sm font-medium text-fg-secondary">Which workspaces</legend>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as typeof scope)} className="gap-1">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="all" /> {ask.allWorkspaces ? "All of them, and new ones" : "All you may open"}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="some" /> Only these:
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
          Connect
        </button>
        <button type="button" disabled={busy} onClick={() => decide("deny")} className={buttonVariants({ variant: "secondary" })}>
          Deny
        </button>
      </div>
      <p className="mt-4 text-xs text-fg-muted">
        It can never do more than you can. Settings → API keys → Connected AI apps lists it; revoke it there at any time.
      </p>
    </>
  );
}
