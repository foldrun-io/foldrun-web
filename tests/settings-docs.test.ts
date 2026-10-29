// Every operator setting the open platform reads is documented, by its key
// and its fallback variable, in foldrun-docs environment.md (30 Oct 2026).
// One registry (foldrun-platform src/settings.ts) drives the console's form,
// the API's validation and this check.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { OPEN_SETTINGS } = await import("../../foldrun-platform/src/settings.ts");
const docs = fs.readFileSync(path.join(import.meta.dirname, "../../foldrun-docs/environment.md"), "utf8");

test("every open setting is in environment.md's operator settings, by key and variable", () => {
  const section = docs.slice(docs.indexOf("## Operator settings"), docs.indexOf("## Core"));
  assert.ok(section.length > 100, "environment.md has an Operator settings section before Core");
  const missing = OPEN_SETTINGS.filter((d) => !section.includes(`| \`${d.key}\` | \`${d.env}\` |`)).map((d) => d.key);
  assert.deepEqual(missing, []);
  const documented = [...section.matchAll(/^\| `([a-z_.]+)` \| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
  const stale = documented.filter((k) => !OPEN_SETTINGS.some((d) => d.key === k));
  assert.deepEqual(stale, [], "a documented key the registry no longer has");
});
