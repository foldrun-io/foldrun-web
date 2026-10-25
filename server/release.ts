// What this install is running: the version a person reads, when it was
// released, the shas behind it, and the notes for the releases before it.
//
// The deploy writes `release.json` into this tree before the image is built
// (foldrun-infra/dev/ci/changelog.mjs), so the record ships inside the image
// it describes. Without the file — `next dev`, a self-hosted build, a deploy
// whose notes step failed — the answer falls back to what the rollout puts
// in the environment: FOLDRUN_VERSION (the name) and FOLDRUN_BUILD (the five
// short shas, core.platform.web.docs.infra). Never throws: a version endpoint
// that 500s is worse than one that says "dev".

import fs from "node:fs";
import path from "node:path";

/**
 * The HTTP API's contract version, Stripe-style: a date that changes only
 * when a route changes in a way an existing caller would break on. Additive
 * changes — a new route, a new field — do not move it.
 */
export const API_VERSION = "2026-10-26";

export const COMPONENTS = ["core", "platform", "web", "docs", "infra", "cli", "admin"] as const;
export type Component = (typeof COMPONENTS)[number];

export interface NoteLine {
  repo: string;
  sha: string;
  subject: string;
}
export interface ReleaseNotes {
  features: NoteLine[];
  fixes: NoteLine[];
  docs: NoteLine[];
  other: NoteLine[];
}
export interface Release {
  version: string;
  released_at: string | null;
  previous: string | null;
  components: Partial<Record<Component, string | null>>;
  /** null when the notes could not be built (the first release, a compare that failed). */
  notes: ReleaseNotes | null;
}
export interface VersionInfo {
  version: string;
  released_at: string | null;
  build: string | null;
  api: string;
  components: Record<Component, string | null>;
  packages: { core: string | null; cli: string | null };
  /** The browser engines the runner image was built with — the installed
   *  entries of its /opt/browser/engines.json, which the deploy reads out of
   *  the image it just built and sets as FOLDRUN_RUNNER_ENGINES. Chrome and
   *  Lightpanda are best-effort installs on some arches, so this is what
   *  `engine: chrome` really gets here. null when the deploy did not say. */
  browsers: string[] | null;
  /** The versions among them, where the image's manifest had a dotted one —
   *  `{ chrome: "154.0.8037.58", lightpanda: "0.4.1" }`. `foldrun check`
   *  compares a pinned user_agent's Chrome with `chrome`. null when none. */
  browser_versions: Record<string, string> | null;
}

interface ReleaseFile extends Partial<Omit<VersionInfo, "api">> {
  releases?: Release[];
}

const releaseFile = () => process.env.FOLDRUN_RELEASE_FILE ?? path.join(process.cwd(), "release.json");

let cached: { file: string; mtimeMs: number; data: ReleaseFile | null } | null = null;

/** The deploy's file, parsed — re-read only when it changes on disk. */
function readFile(): ReleaseFile | null {
  const file = releaseFile();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    cached = { file, mtimeMs, data: null };
    return null;
  }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.data;
  let data: ReleaseFile | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.version === "string") data = parsed;
  } catch {
    data = null;
  }
  cached = { file, mtimeMs, data };
  return data;
}

function packageVersion(rel: string): string | null {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8")).version ?? "") || null;
  } catch {
    return null;
  }
}

/** FOLDRUN_BUILD (core.platform.web.docs.infra, then .admin on a hosted
 *  build from 25 Oct 2026 — foldrun-admin laid over the public repos) →
 *  component shas. */
export function componentsOfBuild(build: string | null | undefined): Record<Component, string | null> {
  const out = Object.fromEntries(COMPONENTS.map((c) => [c, null])) as Record<Component, string | null>;
  const parts = (build ?? "").split(".").map((s) => s.trim());
  if ((parts.length === 5 || parts.length === 6) && parts.every((p) => /^[0-9a-f]{7,40}$/.test(p))) {
    (["core", "platform", "web", "docs", "infra", "admin"] as const).slice(0, parts.length).forEach((c, i) => (out[c] = parts[i].slice(0, 7)));
  }
  return out;
}

/** What this install is running. The environment wins on the version name:
 *  it is what the rollout set and what healthz reports, so the two always agree. */
export function versionInfo(): VersionInfo {
  const file = readFile();
  const envVersion = process.env.FOLDRUN_VERSION?.trim() || null;
  const envBuild = process.env.FOLDRUN_BUILD?.trim() || null;
  // The file describes a version; if the environment names a different one
  // (a rollout set a version the file was not built for), the file's shas
  // and date are not this version's — use only what the environment says.
  const fileMatches = file && (!envVersion || file.version === envVersion);
  const fromEnv = componentsOfBuild(envBuild);
  const components = fileMatches
    ? ({ ...fromEnv, ...Object.fromEntries(COMPONENTS.map((c) => [c, file!.components?.[c] ?? fromEnv[c] ?? null])) } as Record<Component, string | null>)
    : fromEnv;
  return {
    version: envVersion ?? file?.version ?? "dev",
    released_at: fileMatches ? (file!.released_at ?? null) : null,
    build: envBuild ?? (fileMatches ? (file!.build ?? null) : null),
    api: API_VERSION,
    components,
    packages: {
      core: (fileMatches ? file!.packages?.core : null) ?? packageVersion("../foldrun-core/package.json"),
      cli: (fileMatches ? file!.packages?.cli : null) ?? null,
    },
    browsers: runnerEngines(),
    browser_versions: runnerEngineVersions(),
  };
}

/** FOLDRUN_RUNNER_ENGINES (chromium,chrome=154.0.8037.58,firefox,…) as a
 *  list of names; null unset. A name may carry `=<version>` (foldrun-infra
 *  dev/ci/runner-engines.sh); runnerEngineVersions reads those. */
export function runnerEngines(raw = process.env.FOLDRUN_RUNNER_ENGINES): string[] | null {
  const list = engineParts(raw).map((p) => p.name);
  return list.length ? list : null;
}

/** The dotted versions FOLDRUN_RUNNER_ENGINES carries, by engine; null when none. */
export function runnerEngineVersions(raw = process.env.FOLDRUN_RUNNER_ENGINES): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const p of engineParts(raw)) if (p.version) out[p.name] = p.version;
  return Object.keys(out).length ? out : null;
}

function engineParts(raw: string | undefined): { name: string; version: string | null }[] {
  const out: { name: string; version: string | null }[] = [];
  for (const part of (raw ?? "").split(",")) {
    const m = /^\s*([a-z][a-z0-9-]{0,31})(?:=(\d+(?:\.\d+){1,3}))?\s*$/.exec(part);
    if (m) out.push({ name: m[1], version: m[2] ?? null });
  }
  return out;
}

/** The newest `limit` releases, newest first. Empty without the deploy's file. */
export function releases(limit = 10): Release[] {
  const list = readFile()?.releases;
  if (!Array.isArray(list)) return [];
  return list.slice(0, Math.max(0, Math.min(limit, 50)));
}

/** The response headers every /api response carries. */
export function versionHeaders(): Record<string, string> {
  const v = versionInfo();
  const h: Record<string, string> = { "x-foldrun-version": v.version, "x-foldrun-api": v.api };
  if (v.packages.cli) h["x-foldrun-cli"] = v.packages.cli;
  return h;
}

/** For tests: forget the parsed file. */
export function _resetReleaseCache() {
  cached = null;
}
