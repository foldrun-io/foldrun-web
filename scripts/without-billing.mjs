#!/usr/bin/env node
// Lay out foldrun as a public checkout has it — no billing — in a scratch
// folder, so it can be typechecked, tested and built that way.
//
//   node scripts/without-billing.mjs <out-dir>
//
// Copies the sibling repos this dashboard compiles from (foldrun-core,
// foldrun-platform, foldrun-docs, foldrun-cli and this one) into <out-dir>,
// without node_modules, .next or .git.
// Then, as a public checkout will be:
//   - billing's modules in foldrun-platform (tests/billing-boundary-lists.ts
//     PRIVATE) and billing's pages, routes and server code in foldrun-web
//     (tests/billing-files.ts) are deleted;
//   - src/billing-hosted.ts becomes the stub: `hosted = null`, so billing()
//     answers freeBilling;
//   - a test that imports anything deleted is deleted with it, and so is
//     every *-billing.test.ts: they are billing's tests and move with it.
// It prints what it removed. scripts/without-billing-check.sh runs the
// checks on the result.

import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "");
if (process.argv[2]?.startsWith("--")) {
  console.error("usage: node scripts/without-billing.mjs <out-dir> [--link]");
  process.exit(2);
}
if (!process.argv[2]) {
  console.error("usage: node scripts/without-billing.mjs <out-dir>");
  process.exit(2);
}
const here = path.resolve(import.meta.dirname, "..");
const parent = path.dirname(here);
const REPOS = ["foldrun-core", "foldrun-platform", "foldrun-docs", "foldrun-cli", path.basename(here)];
const SKIP = new Set(["node_modules", ".next", ".git", "coverage", ".turbo"]);

const { PRIVATE, HOSTED_STUB, importsOf } = await import(path.join(parent, "foldrun-platform/tests/billing-boundary-lists.ts"));
const { BILLING_FILES, STUBS } = await import(path.join(here, "tests/billing-files.ts"));

function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copy(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
    else if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(a), b);
  }
}

// The output is replaced wholesale, so it must be a scratch folder: not a
// source repository, not inside one, not holding one — and, if it exists,
// either empty or one this script made (it leaves a marker).
const MARK = ".without-billing";
/** The real path of `p`: symlinks resolved on the part that exists, the
 *  rest appended — so an alias cannot hide that `out` is inside a repo. */
function real(p) {
  let head = p;
  const tail = [];
  while (!fs.existsSync(head)) {
    tail.unshift(path.basename(head));
    head = path.dirname(head);
  }
  return path.join(fs.realpathSync(head), ...tail);
}
const outReal = real(out);
for (const repo of REPOS) {
  const src = path.join(parent, repo);
  if (!fs.existsSync(src)) continue;
  const srcReal = fs.realpathSync(src);
  const inside = (a, b) => a === b || a.startsWith(b + path.sep);
  if (inside(outReal, srcReal) || inside(srcReal, outReal)) {
    console.error(`without-billing: refusing ${out} — it overlaps ${src}`);
    process.exit(2);
  }
}
if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, MARK))) {
  console.error(`without-billing: refusing ${out} — not empty and not made by this script`);
  process.exit(2);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, MARK), "made by foldrun-web/scripts/without-billing.mjs; safe to delete\n");
for (const repo of REPOS) {
  const from = path.join(parent, repo);
  if (!fs.existsSync(from)) continue;
  copy(from, path.join(out, repo));
  // --link: point node_modules back at the checkout's (fast; tests and
  // typecheck only — Turbopack will not read outside its root, so a build
  // needs a real install: without-billing-check.sh runs npm ci instead).
  if (process.argv.includes("--link") && fs.existsSync(path.join(from, "node_modules"))) fs.symlinkSync(path.join(from, "node_modules"), path.join(out, repo, "node_modules"));
}

const removed = new Set();
const platform = path.join(out, "foldrun-platform");
for (const m of PRIVATE) {
  const f = path.join(platform, "src", `${m}.ts`);
  if (fs.existsSync(f)) {
    fs.rmSync(f);
    removed.add(f);
  }
}
fs.writeFileSync(path.join(platform, "src/billing-hosted.ts"), HOSTED_STUB);

const web = path.join(out, path.basename(here));
for (const p of BILLING_FILES) {
  const f = path.join(web, p);
  if (!fs.existsSync(f)) continue;
  const walk = (x) => (fs.statSync(x).isDirectory() ? fs.readdirSync(x).forEach((n) => walk(path.join(x, n))) : removed.add(x));
  walk(f);
  fs.rmSync(f, { recursive: true, force: true });
}

for (const [file, stub] of Object.entries(STUBS)) fs.writeFileSync(path.join(web, file), stub);

/** Where an import in `file` lands, as an absolute path without extension. */
function resolve(file, spec) {
  if (spec.startsWith("@/platform/")) return path.join(platform, "src", spec.slice(11));
  if (spec.startsWith("@/lib/")) return path.join(out, "foldrun-core/src", spec.slice(6));
  if (spec.startsWith("@/") && file.startsWith(web + path.sep)) return path.join(web, spec.slice(2));
  if (spec.startsWith(".")) return path.resolve(path.dirname(file), spec);
  return null;
}
const gone = (abs) =>
  [...removed].some((r) => {
    const bare = r.replace(/\.(ts|tsx)$/, "");
    return abs.replace(/\.(ts|tsx)$/, "") === bare || r.startsWith(abs + path.sep);
  });

const droppedTests = [];
for (const dir of [path.join(platform, "tests"), path.join(web, "tests")]) {
  for (const name of fs.readdirSync(dir)) {
    if (!/\.test\.tsx?$/.test(name)) continue;
    const file = path.join(dir, name);
    // Named as billing's half of a split test file: moves with billing.
    if (/-billing\.test\.tsx?$/.test(name)) {
      fs.rmSync(file);
      droppedTests.push(`${path.relative(out, file)} (billing's half)`);
      continue;
    }
    const hit = importsOf(fs.readFileSync(file, "utf8")).find((i) => {
      const abs = resolve(file, i.module);
      return abs && gone(abs);
    });
    if (hit) {
      fs.rmSync(file);
      droppedTests.push(`${path.relative(out, file)} (imports ${hit.module})`);
    }
  }
}

console.log(`without-billing: ${removed.size} billing files removed, stub billing-hosted.ts written`);
console.log(`without-billing: ${droppedTests.length} billing tests removed:\n  ${droppedTests.join("\n  ")}`);
