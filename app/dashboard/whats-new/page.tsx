// What's new: the releases this install has run, newest first, each with
// what changed since the one before. The notes are written by the deploy
// from commit subjects (foldrun-infra/dev/ci/changelog.mjs) and ship in the
// image — this page reads the same record /api/changelog serves. Above them,
// the API's own changelog: its dated versions, what each one broke, and the
// routes on their way out, from server/api-version.ts.

import Link from "@foldrun/ui/react/link";
import { Page, PageHeader, Card, Chip, EmptyState, Panel } from "@foldrun/ui/react/page";
import { Sparkles } from "lucide-react";
import { releases, versionInfo, type Release, type NoteLine } from "@/server/release";
import { ComponentTable, VersionFacts } from "@/components/version-table";
import { apiChangelog, type ApiChangelog } from "@/server/api-version";
import { Tooltip } from "@foldrun/ui/react/tooltip";

export const dynamic = "force-dynamic";
export const metadata = { title: "What's new" };

const GROUPS: { key: keyof NonNullable<Release["notes"]>; title: string }[] = [
  { key: "features", title: "Features" },
  { key: "fixes", title: "Fixes" },
  { key: "docs", title: "Docs" },
  { key: "other", title: "Other" },
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
          {current && <Chip tone="good">running</Chip>}
        </h2>
        <p className="text-sm text-fg-muted">
          {day(r.released_at)}
          {r.previous && <> · since <a href={`#${r.previous}`} className="font-mono hover:underline">{r.previous}</a></>}
        </p>
      </div>
      {!r.notes ? (
        <p className="mt-3 text-sm text-fg-muted">{r.previous ? "No notes for this release — the deploy could not read what changed." : "The first release on record."}</p>
      ) : count === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">No changes since {r.previous} — the same code, deployed again.</p>
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
          API <span className="font-mono">{api.current}</span>
          <Chip tone="good">current</Chip>
        </h2>
        <p className="text-sm text-fg-muted">
          Pin a version in{" "}
          <Link href="/dashboard/settings?tab=api#api" className="text-link hover:underline">
            Settings → API keys → API
          </Link> · each one works for at least{" "}
          {api.supportMonths} months after the next · <Link href="/dashboard/docs/api-usage" className="text-link hover:underline">how versions work</Link>
        </p>
      </div>
      {broke.length === 0 && api.deprecations.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          Nothing has changed in a way existing code would break on since {api.versions.at(-1)?.version}, and nothing is deprecated.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {broke.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-medium text-fg">Breaking changes, by version</h3>
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
              <h3 className="mb-1.5 text-sm font-medium text-fg">Deprecated</h3>
              <ul>
                {api.deprecations.map((d) => (
                  <li key={d.route} className="py-0.5 text-sm text-fg-secondary">
                    <span className="font-mono text-xs">{d.route}</span> — since {d.deprecatedAt}
                    {d.sunsetAt ? <>, stops answering {d.sunsetAt}</> : <>, no end date yet</>}
                    {d.link && (
                      <>
                        {" "}
                        · <a href={d.link} className="text-link hover:underline">what replaces it</a>
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
        title="What's new"
        description={
          <>
            This install runs <span className="font-mono text-fg">{info.version}</span>. A version is a deploy: the date it went out and that day&apos;s counter.{" "}
            <Link href="/dashboard/docs/versions" className="text-link hover:underline">
              How versions work
            </Link>
            .
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <ApiCard api={apiChangelog()} />
        {list.length === 0 ? (
          <EmptyState icon={<Sparkles />} title="No release notes on this install" description="The deploy writes them; a local or self-built install runs without them. The version and its commits are below." />
        ) : (
          list.map((r) => <ReleaseCard key={r.version} r={r} current={r.version === info.version} />)
        )}
        <Panel title="This version" className="mt-4">
          <div className="space-y-6">
            <VersionFacts info={info} />
            <ComponentTable info={info} />
          </div>
        </Panel>
      </div>
    </Page>
  );
}
