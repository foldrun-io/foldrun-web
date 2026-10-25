#!/usr/bin/env node
// Billing stays out of this public repository.
//
//   node scripts/billing-guard.mjs --staged       what is about to be committed (pre-commit)
//   node scripts/billing-guard.mjs [<rev>]        a commit, default HEAD (pre-push, CI)
//
// Refuses a tracked path that is billing's — under BILLING_FILES or a test in
// BILLING_TESTS (tests/billing-files.ts) — and a file in STUBS (the public
// stand-ins foldrun-admin replaces) that is not exactly its stub. A hosted checkout has foldrun-admin
// laid over it (overlay.sh) and .gitignore's those paths; that is a
// convenience, this is the guard.

import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const { BILLING_FILES, BILLING_TESTS, STUBS } = await import(path.join(root, "tests/billing-files.ts"));
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });

const staged = process.argv.includes("--staged");
const rev = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "HEAD";
const files = (staged ? git("ls-files", "-z") : git("ls-tree", "-r", "-z", "--name-only", rev)).split("\0").filter(Boolean);
const where = staged ? "staged" : rev;

const isBilling = (f) =>
  BILLING_FILES.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)) ||
  (f.startsWith("tests/") && BILLING_TESTS.includes(f.slice("tests/".length)));
const problems = files.filter(isBilling).map((f) => `${f} is billing's (foldrun-admin), not this repository's`);
for (const [file, stub] of Object.entries(STUBS)) {
  let text = null;
  try {
    text = git("show", `${staged ? "" : rev}:${file}`);
  } catch {
    problems.push(`${file} is missing`);
  }
  if (text !== null && text !== stub) problems.push(`${file} is not the public stub — the real one belongs to foldrun-admin`);
}
if (problems.length) {
  console.error(`billing-guard (${where}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`billing-guard (${where}): no billing among ${files.length} files`);
