#!/usr/bin/env node
// The API guard: no change an existing caller would break on ships unless it
// is versioned.
//
// The dated API (server/api-version.ts) promises that a caller pinned to a
// version keeps the shape that version had. That promise is only as good as
// the habit of adding a VersionChange whenever a response changes shape — so
// this checks the habit. It builds the OpenAPI document (server/openapi.ts)
// at a base commit and at HEAD, and refuses what an existing caller would
// break on:
//
//   - an operation (method + path) gone
//   - a response field gone, or its type changed
//   - a request field, or query parameter, newly required; a request field
//     no longer accepted, or its type changed; an accepted enum value gone
//
// unless HEAD answers for it:
//
//   - a VERSION_CHANGES entry newer than the base's current version whose
//     routes cover the operation (its `downgrade` gives older pins the old
//     shape), with CURRENT_API_VERSION moved to the newest such entry; or
//   - for an operation gone, a DEPRECATIONS entry the BASE already had for it
//     whose sunsetAt has passed — it was announced, and its time is up; or
//   - a SCHEMA_CORRECTIONS entry for the operation: the document was wrong
//     and the API never behaved that way. Reported, not refused.
//
// New operations, new response fields, new optional request fields and new
// enum values in responses are additions, never breaks: clients must ignore
// what they do not know (docs: api-usage.md). Only documented schemas can be
// compared — an operation answered with the generic object schema is checked
// for existence only, which is why a route you change should get a schema.
//
// The base: --base <ref>, else $API_GUARD_BASE (CI: the commit the push or
// pull request started from), else the web commit in the newest box version
// tag of ../foldrun-infra (what is deployed), else the merge base with
// origin/main.
//
//   node scripts/api-guard.mjs [--base <ref>]

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const METHODS = ["get", "post", "put", "patch", "delete", "head"];

// ------------------------------------------------------------- comparing

/** A JSON pointer-ish location for messages. */
const at = (where, key) => (where ? `${where}.${key}` : key);

/** Follow a local $ref. */
function deref(doc, s) {
  let out = s;
  for (let i = 0; out?.$ref && i < 10; i++) {
    const p = out.$ref.replace(/^#\//, "").split("/");
    out = p.reduce((o, k) => o?.[k], doc);
  }
  return out ?? {};
}

const typeOf = (s) => (Array.isArray(s.type) ? [...s.type].sort().join("|") : s.type ?? null);

/**
 * What a client reading a RESPONSE would break on: a field gone, a type
 * changed. `a` is the old schema, `b` the new.
 */
export function responseBreaks(docA, a, docB, b, where = "") {
  const out = [];
  const x = deref(docA, a);
  const y = deref(docB, b);
  if (typeOf(x) && typeOf(y) && typeOf(x) !== typeOf(y)) {
    out.push(`response ${where ? `field ${where}` : "body"} was ${typeOf(x)}, now ${typeOf(y)}`);
    return out;
  }
  for (const [k, v] of Object.entries(x.properties ?? {})) {
    if (!y.properties || !(k in y.properties)) {
      if (y.additionalProperties && !x.additionalProperties) continue; // became a map: still has it
      out.push(`response field ${at(where, k)} is gone`);
    } else out.push(...responseBreaks(docA, v, docB, y.properties[k], at(where, k)));
  }
  if (x.items && y.items) out.push(...responseBreaks(docA, x.items, docB, y.items, `${where}[]`));
  return out;
}

/**
 * What a client SENDING a request would break on: a field newly required,
 * one no longer accepted, a type changed, an enum value refused.
 */
export function requestBreaks(docA, a, docB, b, where = "") {
  const out = [];
  const x = deref(docA, a);
  const y = deref(docB, b);
  if (typeOf(x) && typeOf(y) && typeOf(x) !== typeOf(y)) {
    out.push(`request ${where ? `field ${where}` : "body"} was ${typeOf(x)}, now ${typeOf(y)}`);
    return out;
  }
  if (Array.isArray(x.enum) && Array.isArray(y.enum)) {
    for (const v of x.enum) if (!y.enum.includes(v)) out.push(`request ${where ? `field ${where}` : "body"} no longer accepts ${JSON.stringify(v)}`);
  }
  const was = new Set(x.required ?? []);
  for (const k of y.required ?? []) if (!was.has(k)) out.push(`request field ${at(where, k)} is now required`);
  for (const [k, v] of Object.entries(x.properties ?? {})) {
    if (y.properties && !(k in y.properties) && y.additionalProperties !== true) out.push(`request field ${at(where, k)} is no longer accepted`);
    else if (y.properties?.[k]) out.push(...requestBreaks(docA, v, docB, y.properties[k], at(where, k)));
  }
  if (x.items && y.items) out.push(...requestBreaks(docA, x.items, docB, y.items, `${where}[]`));
  return out;
}

const json200 = (op) => op?.responses?.["200"]?.content?.["application/json"]?.schema ?? null;
const jsonBody = (op) => op?.requestBody?.content?.["application/json"]?.schema ?? null;
const queryParams = (doc, op) => (op?.parameters ?? []).map((p) => deref(doc, p)).filter((p) => p.in === "query");

/** Every break between two OpenAPI documents: `{ method, path, what }`. */
export function apiBreaks(docA, docB) {
  const out = [];
  for (const [p, ops] of Object.entries(docA.paths ?? {})) {
    for (const m of METHODS) {
      const opA = ops[m];
      if (!opA) continue;
      const opB = docB.paths?.[p]?.[m];
      const op = { method: m.toUpperCase(), path: p };
      if (!opB) {
        out.push({ ...op, what: "the operation is gone" });
        continue;
      }
      const ra = json200(opA);
      const rb = json200(opB);
      if (ra && rb) for (const what of responseBreaks(docA, ra, docB, rb)) out.push({ ...op, what });
      const ba = jsonBody(opA);
      const bb = jsonBody(opB);
      if (ba && bb) for (const what of requestBreaks(docA, ba, docB, bb)) out.push({ ...op, what });
      else if (!ba && bb && opB.requestBody?.required && Object.keys(deref(docB, bb).required ?? []).length) {
        out.push({ ...op, what: "a request body is now required" });
      }
      const qa = new Map(queryParams(docA, opA).map((q) => [q.name, q]));
      for (const q of queryParams(docB, opB)) {
        if (q.required && !qa.get(q.name)?.required) out.push({ ...op, what: `query parameter ${q.name} is now required` });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- what answers for a break

/** A concrete URL path for a templated one, so a route's RegExp can be tried on it. */
const sample = (p) => p.replace(/\{[^}]+\}/g, "x").replace(/\[[^\]]+\]/g, "x");

/**
 * Sort breaks into refused and answered. `head` and `base` are what
 * describe() returns for each tree.
 */
export function judge(breaks, base, head, today = new Date().toISOString().slice(0, 10)) {
  const refused = [];
  const answered = [];
  const fresh = head.changes.filter((c) => c.version > base.current);
  const problems = [];
  if (fresh.length) {
    const newest = fresh.map((c) => c.version).sort().at(-1);
    if (head.current !== newest) problems.push(`VERSION_CHANGES has ${newest}, but CURRENT_API_VERSION is ${head.current}: move API_VERSION in server/release.ts to ${newest}`);
  }
  for (const b of breaks) {
    const url = sample(b.path);
    const covers = (r) => r.method === b.method && new RegExp(r.path).test(url);
    const change = fresh.find((c) => c.routes.some(covers));
    if (change) {
      answered.push({ ...b, by: `version ${change.version}: ${change.summary}` });
      continue;
    }
    const correction = head.corrections.find((c) => c.method === b.method && c.path === b.path);
    if (correction) {
      answered.push({ ...b, by: `schema correction: ${correction.reason}` });
      continue;
    }
    if (b.what === "the operation is gone") {
      const dep = base.deprecations.find((d) => covers(d));
      if (dep?.sunsetAt && dep.sunsetAt <= today) {
        answered.push({ ...b, by: `deprecated ${dep.deprecatedAt}, sunset ${dep.sunsetAt}` });
        continue;
      }
    }
    refused.push(b);
  }
  return { refused, answered, problems };
}

// ------------------------------------------------------------- reading a tree

function git(args, cwd = webRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}
const isZero = (ref) => !ref || /^0+$/.test(ref);

/** The web commit of the newest box version tag in ../foldrun-infra. */
export function deployedWebSha(infraDir) {
  if (!fs.existsSync(path.join(infraDir, ".git"))) return null;
  const tag = tryGit(["tag", "-l", "v*", "--sort=-creatordate"], infraDir)?.split("\n")[0];
  if (!tag) return null;
  const msg = tryGit(["tag", "-l", "--format=%(contents)", tag], infraDir) ?? "";
  const sha = /^web=([0-9a-f]{7,40})$/m.exec(msg)?.[1];
  return sha ? { sha, tag } : null;
}

function resolveBase(explicit) {
  // A ref is passed to git as an argument: one starting with "-" would be
  // read as an option (`git archive --output=…`). Commits and branch names
  // never start with one.
  const has = (ref) => !String(ref).startsWith("-") && tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
  if (!isZero(explicit)) {
    if (!has(explicit)) throw new Error(`base ${explicit} (from --base) is not a commit here — fetch more history (fetch-depth: 0)`);
    return { ref: explicit, why: "--base" };
  }
  const env = process.env.API_GUARD_BASE;
  if (!isZero(env)) {
    if (has(env)) return { ref: env, why: "$API_GUARD_BASE" };
    console.log(`api-guard: $API_GUARD_BASE ${env} is not a commit here; falling back`);
  }
  const deployed = deployedWebSha(path.join(webRoot, "..", "foldrun-infra"));
  if (deployed) {
    if (!has(deployed.sha)) tryGit(["fetch", "--quiet", "origin", deployed.sha]);
    if (has(deployed.sha)) return { ref: deployed.sha, why: `web at box version ${deployed.tag}` };
  }
  if (has("origin/main")) {
    const head = git(["rev-parse", "HEAD"]);
    const main = git(["rev-parse", "origin/main"]);
    if (head !== main) {
      const mb = tryGit(["merge-base", "HEAD", "origin/main"]);
      if (mb) return { ref: mb, why: "merge base with origin/main" };
    }
    if (has("origin/main~1")) return { ref: "origin/main~1", why: "origin/main~1" };
  }
  return null;
}

/** The OpenAPI document and the version registry of the tree at `dir`. */
function describe(dir) {
  const code = `
    const doc = (await import(${JSON.stringify(pathToFileURL(path.join(dir, "server/openapi.ts")).href)})).openapiDocument();
    const v = await import(${JSON.stringify(pathToFileURL(path.join(dir, "server/api-version.ts")).href)});
    const re = (r) => ({ method: r.method, path: r.path.source });
    console.log(JSON.stringify({
      doc,
      current: v.CURRENT_API_VERSION,
      changes: (v.VERSION_CHANGES ?? []).map((c) => ({ version: c.version, summary: c.summary, routes: c.routes.map(re) })),
      deprecations: (v.DEPRECATIONS ?? []).map((d) => ({ ...re(d), deprecatedAt: d.deprecatedAt, sunsetAt: d.sunsetAt ?? null })),
      corrections: v.SCHEMA_CORRECTIONS ?? [],
    }));`;
  const r = spawnSync(process.execPath, ["--no-warnings", "--import", path.join(webRoot, "tests", "register.mjs"), "--input-type=module", "-e", code], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`could not build the OpenAPI document in ${dir}:\n${r.stderr.trim().split("\n").slice(-8).join("\n")}`);
  return JSON.parse(r.stdout.trim().split("\n").at(-1));
}

/** The tree at `ref`, unpacked: the server/ folder and node_modules beside it. */
function treeAt(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-guard-"));
  if (ref.startsWith("-")) throw new Error(`not a commit: ${ref}`);
  const tar = execFileSync("git", ["archive", ref, "--", "server"], { cwd: webRoot, maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  fs.symlinkSync(path.join(webRoot, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

// ------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--base");
  const base = resolveBase(i >= 0 ? argv[i + 1] : null);
  if (!base) {
    console.log("api-guard: no base to compare with (no --base, no ../foldrun-infra tags, no origin/main) — nothing checked");
    return 0;
  }
  if (tryGit(["cat-file", "-e", `${base.ref}:server/openapi.ts`]) === null) {
    console.log(`api-guard: the base (${base.why}) has no server/openapi.ts — nothing to compare`);
    return 0;
  }
  const dir = treeAt(base.ref);
  try {
    const before = describe(dir);
    const after = describe(webRoot);
    const { refused, answered, problems } = judge(apiBreaks(before.doc, after.doc), before, after);
    const label = `${base.why}, ${base.ref.slice(0, 7)}`;
    for (const a of answered) console.log(`api-guard: ${a.method} ${a.path}: ${a.what} — answered by ${a.by}`);
    for (const p of problems) console.error(`api-guard: ${p}`);
    if (!refused.length && !problems.length) {
      console.log(`api-guard: no unversioned breaking change since ${label}`);
      return 0;
    }
    if (refused.length) {
      console.error(`api-guard: ${refused.length} change${refused.length === 1 ? "" : "s"} since ${label} would break callers pinned to the current API version:\n`);
      for (const r of refused) console.error(`  ${r.method} ${r.path}: ${r.what}`);
      console.error(`
Keep the old shape (add the new thing beside it), or version it: add a
VersionChange to VERSION_CHANGES in server/api-version.ts with a downgrade
that gives older pins the old shape, answer the route with versionedJson(),
and move API_VERSION in server/release.ts to that version's date. Removing
an operation needs a DEPRECATIONS entry released first and its sunsetAt
passed. If the document was wrong and the API never behaved that way, add
a SCHEMA_CORRECTIONS entry saying so.`);
    }
    return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`api-guard: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
