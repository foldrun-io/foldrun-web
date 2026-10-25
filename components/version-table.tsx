// The version and the commits behind it, as a table. One rendering for
// Settings → About, the super admin console and What's new, so the three
// cannot disagree about what a component is called or where its sha links.

import type { VersionInfo } from "@/server/release";

const REPO_OF: Record<string, string> = {
  core: "foldrun-core",
  platform: "foldrun-platform",
  web: "foldrun-web",
  docs: "foldrun-docs",
  infra: "foldrun-infra",
  cli: "foldrun-cli",
};

const WHAT: Record<string, string> = {
  core: "the runtime: the format, the engine, check",
  platform: "the hosted layer: queue, worker, storage, billing",
  web: "this dashboard and the HTTP API",
  docs: "the documentation",
  infra: "how it is built and deployed",
  cli: "the CLI released with this version",
};

export function VersionFacts({ info }: { info: VersionInfo }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
      <dt className="text-fg-muted">Version</dt>
      <dd className="font-mono text-fg">{info.version}</dd>
      <dt className="text-fg-muted">Released</dt>
      <dd className="text-fg">{info.released_at ? new Date(info.released_at).toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC") : "—"}</dd>
      <dt className="text-fg-muted">API version</dt>
      <dd className="font-mono text-fg">{info.api}</dd>
      <dt className="text-fg-muted">Build</dt>
      <dd className="break-all font-mono text-xs text-fg-tertiary">{info.build ?? "—"}</dd>
      {info.packages.core && (
        <>
          <dt className="text-fg-muted">@foldrun/core</dt>
          <dd className="font-mono text-fg">{info.packages.core}</dd>
        </>
      )}
      {info.packages.cli && (
        <>
          <dt className="text-fg-muted">CLI</dt>
          <dd className="font-mono text-fg">
            foldrun {info.packages.cli} <span className="font-sans text-xs text-fg-muted">— npm i -g foldrun@latest</span>
          </dd>
        </>
      )}
      {info.browsers && (
        <>
          <dt className="text-fg-muted">Browsers</dt>
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
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            <th className="py-1.5 pr-4 font-medium">Component</th>
            <th className="py-1.5 pr-4 font-medium">Commit</th>
            <th className="py-1.5 font-medium">What it is</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, sha]) => (
            <tr key={name} className="border-b border-line-faint last:border-0">
              <td className="py-1.5 pr-4 font-mono text-xs text-fg">{REPO_OF[name] ?? name}</td>
              <td className="py-1.5 pr-4 font-mono text-xs text-fg-secondary">{sha ?? <span className="text-gray-300">—</span>}</td>
              <td className="py-1.5 text-xs text-fg-muted">{WHAT[name] ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
