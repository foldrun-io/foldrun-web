// The version and the commits behind it, as a table. One rendering for
// Settings → About and What's new, so the two cannot disagree about what a component is called or where its sha links.

import { $rich, $t, localized } from "@/i18n";
import type { VersionInfo } from "@/server/release";

const REPO_OF: Record<string, string> = {
  core: "foldrun-core",
  platform: "foldrun-platform",
  web: "foldrun-web",
  docs: "foldrun-docs",
  infra: "foldrun-infra",
  cli: "foldrun-cli",
};

const WHAT: Record<string, string> = localized(() => ({
  core: $t("components.version-table.theRuntimeTheFormatTheEngine"),
  platform: $t("components.version-table.theHostedLayerQueueWorkerStorage"),
  web: $t("components.version-table.thisDashboardAndTheHttpApi"),
  docs: $t("components.version-table.theDocumentation"),
  infra: $t("components.version-table.howItIsBuiltAndDeployed"),
  cli: $t("components.version-table.theCliReleasedWithThisVersion"),
}));

export function VersionFacts({ info }: { info: VersionInfo }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      <dt className="text-fg-muted">{$t("components.version-table.version")}</dt>
      <dd className="font-mono text-fg">{info.version}</dd>
      <dt className="text-fg-muted">{$t("components.version-table.released")}</dt>
      <dd className="text-fg">{info.released_at ? new Date(info.released_at).toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC") : "—"}</dd>
      <dt className="text-fg-muted">{$t("components.version-table.apiVersion")}</dt>
      <dd className="font-mono text-fg">{info.api}</dd>
      <dt className="text-fg-muted">{$t("components.version-table.build")}</dt>
      <dd className="break-all font-mono text-xs text-fg-tertiary">{info.build ?? "—"}</dd>
      {info.packages.core && (
        <>
          <dt className="text-fg-muted">@foldrun/core</dt>
          <dd className="font-mono text-fg">{info.packages.core}</dd>
        </>
      )}
      {info.packages.cli && (
        <>
          <dt className="text-fg-muted">{$t("components.version-table.cli")}</dt>
          <dd className="font-mono text-fg">
            {$rich("components.version-table.foldrunNpmIGFoldrunLatest", { cli: info.packages.cli, span: (chunks) => <span className="font-sans text-xs text-fg-muted">{chunks}</span> })}
          </dd>
        </>
      )}
      {info.browsers && (
        <>
          <dt className="text-fg-muted">{$t("components.version-table.browsers")}</dt>
          <dd className="font-mono text-fg">
            {info.browsers.map((b) => (info.browser_versions?.[b] ? `${b} ${info.browser_versions[b]}` : b)).join(", ")}
          </dd>
        </>
      )}
    </dl>
  );
}

export function ComponentTable({ info }: { info: VersionInfo }) {
  const rows = Object.entries(info.components);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-fg-muted">
            <th className="py-2 pr-4 font-medium">{$t("components.version-table.component")}</th>
            <th className="py-2 pr-4 font-medium">{$t("components.version-table.commit")}</th>
            <th className="py-2 font-medium">{$t("components.version-table.whatItIs")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, sha]) => (
            <tr key={name} className="border-b border-line-faint last:border-0">
              <td className="py-2 pr-4 font-mono text-xs text-fg">{REPO_OF[name] ?? name}</td>
              <td className="py-2 pr-4 font-mono text-xs text-fg-secondary">{sha ?? <span className="text-fg-subtle">—</span>}</td>
              <td className="py-2 text-xs text-fg-muted">{WHAT[name] ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
