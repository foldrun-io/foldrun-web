"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, buttonClass, selectClass } from "@/components/ui";
import { useCan } from "@/components/role";

export interface ApiFacts {
  version: { current: string; pinned: string | null; effective: string; supported: string[]; supportMonths: number };
  limits: {
    plan: string;
    windowSeconds: number;
    perCredential: { read: number; write: number };
    perAccount: { read: number; write: number };
  };
  /** The last 30 days; null when the counts could not be read. */
  usage: {
    days: number;
    versions: { version: string; requests: number; lastSeen: string }[];
    deprecated: {
      route: string;
      requests: number;
      lastSeen: string;
      deprecatedAt: string | null;
      sunsetAt: string | null;
      link: string | null;
      callers: { credential: string; requests: number; lastSeen: string }[];
    }[];
  } | null;
  /** True for a member limited to some workspaces: the account's use names
   *  every workspace's callers, so it is not shown to them. */
  usageHidden?: true;
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/** Which versions answered this account lately, and any route on its way out
 *  it still calls — with who calls it, so the right script gets moved. */
function ApiUsage({ usage, hidden }: { usage: ApiFacts["usage"]; hidden?: boolean }) {
  if (hidden) return <p className="mt-1 text-xs text-fg-subtle">The account&apos;s API use is shown to members with every workspace.</p>;
  if (!usage) return <p className="mt-1 text-xs text-fg-subtle">Usage could not be read just now.</p>;
  const total = usage.versions.reduce((s, v) => s + v.requests, 0);
  return (
    <>
      {usage.deprecated.length > 0 && (
        <div className="mt-2 rounded-md border border-warning-line bg-warning-soft p-3 text-xs text-warning" role="alert">
          <p className="font-semibold text-fg">This account still calls {usage.deprecated.length === 1 ? "a route" : "routes"} on its way out</p>
          <ul className="mt-1 space-y-2">
            {usage.deprecated.map((d) => (
              <li key={d.route}>
                <span className="font-mono">{d.route}</span> — {d.requests} request{d.requests === 1 ? "" : "s"}, last {day(d.lastSeen)}
                {d.sunsetAt ? <>; stops answering {day(d.sunsetAt)}</> : <>; no end date yet</>}
                {d.link && (
                  <>
                    {" "}
                    · <a href={d.link} className="text-accent hover:underline">what replaces it</a>
                  </>
                )}
                <ul className="mt-0.5 pl-3 text-fg-muted">
                  {d.callers.map((c) => (
                    <li key={c.credential}>
                      {c.credential || "an unknown caller"}: {c.requests}, last {day(c.lastSeen)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {total === 0 ? (
        <p className="mt-1 text-xs text-fg-subtle">No API requests in the last {usage.days} days.</p>
      ) : (
        <table className="mt-2 text-xs text-fg-secondary">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="pr-6 font-normal">Version</th>
              <th className="pr-6 font-normal">Requests, {usage.days} days</th>
              <th className="font-normal">Last</th>
            </tr>
          </thead>
          <tbody>
            {usage.versions.map((v) => (
              <tr key={v.version}>
                <td className="py-0.5 pr-6 font-mono">{v.version}</td>
                <td className="py-0.5 pr-6 font-mono">{v.requests}</td>
                <td className="py-0.5 font-mono">{day(v.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Settings → API: the account's rate limits, and the API version its
 *  requests get when they send no Foldrun-Version header. */
export function ApiSettings({ facts, qs }: { facts: ApiFacts; qs: string }) {
  const router = useRouter();
  const manages = useCan("keys:manage");
  const [pick, setPick] = useState(facts.version.pinned ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { limits, version } = facts;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: pick || null }),
      });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="grid gap-6 p-5 lg:grid-cols-2">
      <div>
        <p className="text-sm font-semibold text-fg">Rate limits</p>
        <p className="mt-1 text-xs text-fg-muted">
          Per minute, on the <span className="font-mono">{limits.plan}</span> plan. Every response carries
          <code className="mx-1 font-mono">X-RateLimit-Remaining</code>; over the limit is a 429 with <code className="font-mono">Retry-After</code>.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-fg-subtle">
              <th className="py-1 font-medium" />
              <th className="py-1 font-medium">Reads</th>
              <th className="py-1 font-medium">Writes</th>
            </tr>
          </thead>
          <tbody className="text-fg-secondary">
            <tr>
              <td className="py-1">Each key or person</td>
              <td className="py-1 font-mono">{limits.perCredential.read}</td>
              <td className="py-1 font-mono">{limits.perCredential.write}</td>
            </tr>
            <tr>
              <td className="py-1">The whole account</td>
              <td className="py-1 font-mono">{limits.perAccount.read}</td>
              <td className="py-1 font-mono">{limits.perAccount.write}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>
        <p className="text-sm font-semibold text-fg">API version</p>
        <p className="mt-1 text-xs text-fg-muted">
          API-key requests without a <code className="font-mono">Foldrun-Version</code> header are answered as{" "}
          <span className="font-mono text-fg-secondary">{version.effective}</span>
          {version.pinned ? " (pinned)" : " (current)"}. The dashboard always uses the current version. A version stays supported for at least {version.supportMonths} months after the one that replaces it.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={selectClass("w-48")} value={pick} onChange={(e) => setPick(e.target.value)} disabled={!manages || busy} aria-label="API version pin">
            <option value="">Always current ({version.current})</option>
            {version.supported.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className={buttonClass("secondary")} onClick={save} disabled={!manages || busy || pick === (version.pinned ?? "")}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {!manages && <p className="mt-2 text-xs text-fg-subtle">An admin can change the pin.</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <p className="mt-4 text-sm font-semibold text-fg">Your use, last 30 days</p>
        <ApiUsage usage={facts.usage} hidden={facts.usageHidden} />
        <p className="mt-4 text-xs">
          <Link href={`/dashboard/docs/api-reference${qs}`} className="text-accent hover:underline">
            API reference
          </Link>
          <span className="text-fg-subtle"> · </span>
          <a href="/api/openapi.json" className="text-accent hover:underline">
            openapi.json
          </a>
        </p>
      </div>
    </Card>
  );
}
