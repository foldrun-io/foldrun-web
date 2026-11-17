// What's new: the releases this install has run, newest first, each with
// what changed since the one before. The notes are written by the deploy
// from commit subjects (foldrun-infra/dev/ci/changelog.mjs) and ship in the
// image — this page reads the same record /api/changelog serves. Above them,
// the API's own changelog: its dated versions, what each one broke, and the
// routes on their way out, from server/api-version.ts.

import { $rich, $t } from "@/i18n";
import Link from "@foldrun/ui/react/link";
import { Page, PageHeader, Card, Chip, EmptyState, Panel } from "@foldrun/ui/react/page";
import { Sparkles } from "lucide-react";
import { releases, versionInfo, type Release, type NoteLine } from "@/server/release";
import { ComponentTable, VersionFacts } from "@/components/version-table";
import { apiChangelog, type ApiChangelog } from "@/server/api-version";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export const dynamic = "force-dynamic";
export const metadata = { title: $t("whats-new.page.whatSNew") };

const GROUPS: { key: keyof NonNullable<Release["notes"]>; title: string }[] = [
  { key: "features", title: $t("whats-new.page.features") },
  { key: "fixes", title: $t("whats-new.page.fixes") },
  { key: "docs", title: $t("whats-new.page.docs") },
  { key: "other", title: $t("whats-new.page.other") },
];

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null);

function Line({ n }: { n: NoteLine }) {
  return (
    <li className="flex gap-2 py-0.5 text-sm text-fg-secondary">
      <Tooltip label={`foldrun-${n.repo} ${n.sha}`}>
        <span className="mt-0.5 w-16 shrink-0 truncate font-mono text-xs text-fg-subtle">
          {n.repo}
        </span>
      </Tooltip>
      <span>{n.subject}</span>
    </li>
  );
}

function ReleaseCard({ r, current }: { r: Release; current: boolean }) {
  const count = r.notes ? GROUPS.reduce((s, g) => s + r.notes![g.key].length, 0) : 0;
  return (
    <Card className="scroll-mt-20 p-5" id={r.version}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-base font-semibold text-fg">
          {r.version}
          {current && <Chip tone="good">{$t("whats-new.page.running")}</Chip>}
        </h2>
        <p className="text-sm text-fg-muted">
          {day(r.released_at)}
          {r.previous && <>{" "}{$rich("whats-new.page.since", { previous: r.previous, a: (chunks) => <a href={`#${r.previous}`} className="font-mono hover:underline">{chunks}</a> })}</>}
        </p>
      </div>
      {!r.notes ? (
        <p className="mt-3 text-sm text-fg-muted">{r.previous ? $t("whats-new.page.noNotesForThisReleaseThe") : $t("whats-new.page.theFirstReleaseOnRecord")}</p>
      ) : count === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{$t("whats-new.page.noChangesSinceTheSameCode", { previous: r.previous ?? "" })}</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {GROUPS.filter((g) => r.notes![g.key].length).map((g) => (
            <section key={g.key}>
              <h3 className="mb-1.5 text-sm font-medium text-fg">
                {g.title} <span className="font-normal text-fg-muted">{r.notes![g.key].length}</span>
              </h3>
              <ul>
                {r.notes![g.key].map((n) => (
                  <Line key={`${n.repo}-${n.sha}`} n={n} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function ApiCard({ api }: { api: ApiChangelog }) {
  const broke = api.versions.filter((v) => v.changes.length);
  return (
    <Card className="scroll-mt-20 p-5" id="api">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
          {$rich("whats-new.page.api", { current: api.current, span: (chunks) => <span className="font-mono">{chunks}</span> })}
          <Chip tone="good">{$t("whats-new.page.current")}</Chip>
        </h2>
        <p className="text-sm text-fg-muted">
          {$rich("whats-new.page.pinAVersionInSettingsApi", { link: (chunks) => <Link href="/dashboard/settings?tab=api#api" className="text-link hover:underline">{chunks}</Link>, supportMonths: String(api.supportMonths), link2: (chunks) => <Link href="/dashboard/docs/api-usage" className="text-link hover:underline">{chunks}</Link> })}
        </p>
      </div>
      {broke.length === 0 && api.deprecations.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          {$t("whats-new.page.nothingHasChangedInAWay", { version: api.versions.at(-1)?.version ?? "" })}
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {broke.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-medium text-fg">{$t("whats-new.page.breakingChangesByVersion")}</h3>
              <ul>
                {broke.map((v) =>
                  v.changes.map((c) => (
                    <li key={`${v.version}-${c}`} className="flex gap-2 py-0.5 text-sm text-fg-secondary">
                      <span className="mt-0.5 shrink-0 font-mono text-xs text-fg-subtle">{v.version}</span>
                      <span>{c}</span>
                    </li>
                  )),
                )}
              </ul>
            </section>
          )}
          {api.deprecations.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-medium text-fg">{$t("whats-new.page.deprecated")}</h3>
              <ul>
                {api.deprecations.map((d) => (
                  <li key={d.route} className="py-0.5 text-sm text-fg-secondary">
                    {$rich("whats-new.page.since2", { route: d.route, span: (chunks) => <span className="font-mono text-xs">{chunks}</span>, deprecatedAt: d.deprecatedAt })}
                    {d.sunsetAt ? <>{$t("whats-new.page.stopsAnswering", { sunsetAt: d.sunsetAt })}</> : <>{$t("whats-new.page.noEndDateYet")}</>}
                    {d.link && (
                      <>
                        {" "}
                        · <a href={d.link} className="text-link hover:underline">{$t("whats-new.page.whatReplacesIt")}</a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}

export default async function WhatsNewPage() {
  const info = versionInfo();
  const list = releases(30);
  return (
    <Page width="narrow" className="pb-16">
      <PageHeader
        title={$t("whats-new.page.whatSNew")}
        description={
          <>
            {$rich("whats-new.page.thisInstallRunsAVersionIs", { version: info.version, span: (chunks) => <span className="font-mono text-fg">{chunks}</span>, link: (chunks) => <Link href="/dashboard/docs/versions" className="text-link hover:underline">{chunks}</Link> })}
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <ApiCard api={apiChangelog()} />
        {list.length === 0 ? (
          <EmptyState icon={<Sparkles />} title={$t("whats-new.page.noReleaseNotesOnThisInstall")} description={$t("whats-new.page.theDeployWritesThemALocal")} />
        ) : (
          list.map((r) => <ReleaseCard key={r.version} r={r} current={r.version === info.version} />)
        )}
        <Panel title={$t("whats-new.page.thisVersion")} className="mt-4">
          <div className="space-y-6">
            <VersionFacts info={info} />
            <ComponentTable info={info} />
          </div>
        </Panel>
      </div>
    </Page>
  );
}
