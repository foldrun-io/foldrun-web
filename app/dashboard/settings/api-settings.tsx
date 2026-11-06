"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectClass } from "@/components/ui";
import { SettingsCard } from "@/components/kit/page";
import { Button } from "@/components/kit/button";
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
  if (hidden) return <p className="text-sm text-fg-muted">The account&apos;s API use is shown to members with every workspace.</p>;
  if (!usage) return <p className="text-sm text-fg-muted">Usage could not be read just now.</p>;
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
                    · <a href={d.link} className="text-link hover:underline">what replaces it</a>
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
        <p className="text-sm text-fg-muted">No API requests in the last {usage.days} days.</p>
      ) : (
        <table className="mt-2 text-sm text-fg-secondary">
          <thead>
            <tr className="text-left text-fg-muted">
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
    <>
      <SettingsCard
        id="api-version"
        title="API version"
        description={
          <>
            API-key requests without a <code className="font-mono">Foldrun-Version</code> header are answered as <span className="font-mono text-fg">{version.effective}</span>
            {version.pinned ? " (pinned)" : " (current)"}. The dashboard always uses the current version. A version stays supported for at least {version.supportMonths} months after the one that replaces it.
          </>
        }
        hint={error ? <span role="alert" className="text-danger">{error}</span> : !manages ? "An admin can change the pin." : undefined}
        footer={
          <Button variant="primary" onClick={save} disabled={!manages || busy || pick === (version.pinned ?? "")}>
            {busy ? "Saving…" : "Save"}
          </Button>
        }
      >
        <select className={selectClass("h-9 w-full max-w-xs")} value={pick} onChange={(e) => setPick(e.target.value)} disabled={!manages || busy} aria-label="API version pin">
          <option value="">Always current ({version.current})</option>
          {version.supported.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </SettingsCard>

      <SettingsCard
        id="rate-limits"
        title="Rate limits"
        description={
          <>
            Per minute, on the <span className="font-mono">{limits.plan}</span> plan. Every response carries <code className="font-mono">X-RateLimit-Remaining</code>; over the limit is a 429 with{" "}
            <code className="font-mono">Retry-After</code>.
          </>
        }
        flush
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-fg-muted">
              <th className="px-5 py-2.5 font-normal sm:px-6" />
              <th className="px-3 py-2.5 font-normal">Reads</th>
              <th className="px-5 py-2.5 font-normal sm:px-6">Writes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-fg">
            <tr>
              <td className="px-5 py-2.5 sm:px-6">Each key or person</td>
              <td className="px-3 py-2.5 font-mono tabular-nums">{limits.perCredential.read}</td>
              <td className="px-5 py-2.5 font-mono tabular-nums sm:px-6">{limits.perCredential.write}</td>
            </tr>
            <tr>
              <td className="px-5 py-2.5 sm:px-6">The whole account</td>
              <td className="px-3 py-2.5 font-mono tabular-nums">{limits.perAccount.read}</td>
              <td className="px-5 py-2.5 font-mono tabular-nums sm:px-6">{limits.perAccount.write}</td>
            </tr>
          </tbody>
        </table>
      </SettingsCard>

      <SettingsCard
        id="api-usage"
        title="Your use, last 30 days"
        description="Requests by API version, and any route on its way out."
        hint={
          <>
            <Link href={`/dashboard/docs/api-reference${qs}`} className="text-link hover:underline">
              API reference
            </Link>
            <span className="text-fg-subtle"> · </span>
            <a href="/api/openapi.json" className="text-link hover:underline">
              openapi.json
            </a>
          </>
        }
      >
        <ApiUsage usage={facts.usage} hidden={facts.usageHidden} />
      </SettingsCard>
    </>
  );
}
