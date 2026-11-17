"use client";

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@foldrun/ui/react/select";
import { SettingsCard, Callout } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
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
  if (hidden) return <p className="text-sm text-fg-muted">{$t("settings.api-settings.theAccountSApiUseIs")}</p>;
  if (!usage) return <p className="text-sm text-fg-muted">{$t("settings.api-settings.usageCouldNotBeReadJust")}</p>;
  const total = usage.versions.reduce((s, v) => s + v.requests, 0);
  return (
    <>
      {usage.deprecated.length > 0 && (
        <Callout tone="warning" className="mt-2 p-3 text-xs" role="alert">
          <p className="font-semibold text-fg">{$t("settings.api-settings.thisAccountStillCallsOnIts", { length: usage.deprecated.length })}</p>
          <ul className="mt-1 space-y-2">
            {usage.deprecated.map((d) => (
              <li key={d.route}>
                {$rich("settings.api-settings.requestLast", { route: d.route, span: (chunks) => <span className="font-mono">{chunks}</span>, requests: d.requests, day: day(d.lastSeen) })}
                {d.sunsetAt ? <>{$t("settings.api-settings.stopsAnswering", { day: day(d.sunsetAt) })}</> : <>{$t("settings.api-settings.noEndDateYet")}</>}
                {d.link && (
                  <>
                    {" "}
                    · <a href={d.link} className="text-link hover:underline">{$t("settings.api-settings.whatReplacesIt")}</a>
                  </>
                )}
                <ul className="mt-0.5 pl-3 text-fg-muted">
                  {d.callers.map((c) => (
                    <li key={c.credential}>
                      {c.credential || $t("settings.api-settings.anUnknownCaller")}{$t("settings.api-settings.last", { requests: String(c.requests), day: day(c.lastSeen) })}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {total === 0 ? (
        <p className="text-sm text-fg-muted">{$t("settings.api-settings.noApiRequestsInTheLast", { days: String(usage.days) })}</p>
      ) : (
        <table className="mt-2 text-sm text-fg-secondary">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="pr-6 font-normal">{$t("settings.api-settings.version")}</th>
              <th className="pr-6 font-normal">{$t("settings.api-settings.requestsDays", { days: String(usage.days) })}</th>
              <th className="font-normal">{$t("settings.api-settings.last2")}</th>
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

/** Settings → API keys → API: the account's rate limits, and the API version its
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
        title={$t("settings.api-settings.apiVersion")}
        description={
          <>
            {$rich("settings.api-settings.apiKeyRequestsWithoutAFoldrun", { code: (chunks) => <code className="font-mono">{chunks}</code>, effective: version.effective, span: (chunks) => <span className="font-mono text-fg">{chunks}</span> })}
            {version.pinned ? " (pinned)" : " (current)"}{$t("settings.api-settings.theDashboardAlwaysUsesTheCurrent", { supportMonths: String(version.supportMonths) })}
          </>
        }
        hint={error ? <span role="alert" className="text-danger">{error}</span> : !manages ? $t("settings.api-settings.anAdminCanChangeThePin") : undefined}
        footer={
          <Button variant="primary" onClick={save} disabled={!manages || busy || pick === (version.pinned ?? "")}>
            {busy ? "Saving…" : $t("settings.api-settings.save")}
          </Button>
        }
      >
        <Select className="w-full max-w-xs" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!manages || busy} aria-label={$t("settings.api-settings.apiVersionPin")}>
          <option value="">{$t("settings.api-settings.alwaysCurrent", { current: version.current })}</option>
          {version.supported.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </SettingsCard>

      <SettingsCard
        id="rate-limits"
        title={$t("settings.api-settings.rateLimits")}
        description={
          <>
            {$rich("settings.api-settings.perMinuteOnThePlanEvery", { plan: limits.plan, span: (chunks) => <span className="font-mono">{chunks}</span>, code: (chunks) => <code className="font-mono">{chunks}</code> })}
          </>
        }
        flush
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-fg-muted">
              <th className="px-5 py-2.5 font-normal sm:px-6" />
              <th className="px-3 py-2.5 font-normal">{$t("settings.api-settings.reads")}</th>
              <th className="px-5 py-2.5 font-normal sm:px-6">{$t("settings.api-settings.writes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-fg">
            <tr>
              <td className="px-5 py-2.5 sm:px-6">{$t("settings.api-settings.eachKeyOrPerson")}</td>
              <td className="px-3 py-2.5 font-mono tabular-nums">{limits.perCredential.read}</td>
              <td className="px-5 py-2.5 font-mono tabular-nums sm:px-6">{limits.perCredential.write}</td>
            </tr>
            <tr>
              <td className="px-5 py-2.5 sm:px-6">{$t("settings.api-settings.theWholeAccount")}</td>
              <td className="px-3 py-2.5 font-mono tabular-nums">{limits.perAccount.read}</td>
              <td className="px-5 py-2.5 font-mono tabular-nums sm:px-6">{limits.perAccount.write}</td>
            </tr>
          </tbody>
        </table>
      </SettingsCard>

      <SettingsCard
        id="api-usage"
        title={$t("settings.api-settings.yourUseLast30Days")}
        description={$t("settings.api-settings.requestsByApiVersionAndAny")}
        hint={
          <>
            <Link href={`/dashboard/docs/api-reference${qs}`} className="text-link hover:underline">
              {$t("settings.api-settings.apiReference")}
            </Link>
            <span className="text-fg-subtle"> · </span>
            <a href="/api/openapi.json" className="text-link hover:underline">
              {$t("settings.api-settings.openapiJson")}
            </a>
          </>
        }
      >
        <ApiUsage usage={facts.usage} hidden={facts.usageHidden} />
      </SettingsCard>
    </>
  );
}
