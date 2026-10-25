// The dashboard and API reach foldrun's billing and operator tools through
// one door, `billing()` from @/platform/billing — the same line the engine
// holds (foldrun-platform/tests/billing-boundary.test.ts, which owns the
// list of what is billing's). Billing's own pages, routes and server code
// (BILLING_FILES below) may import what they like; nothing else may import
// them. That is what lets the dashboard be built without them.
//
//   node --test tests/billing-boundary.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE, importsOf } from "../../foldrun-platform/tests/billing-boundary-lists.ts";
import { BILLING_FILES, STUBS } from "./billing-files.ts";

const ROOT = path.join(import.meta.dirname, "..");

const isBilling = (rel: string) => BILLING_FILES.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

function sources(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (["node_modules", ".next", "tests", "public", ".git"].includes(e.name)) continue;
      out.push(...sources(dir, r));
    } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(r);
  }
  return out;
}

/** Where an import lands, as a path from the repo root (no extension), or
 *  `platform:<module>` for the engine. */
function target(from: string, spec: string): string | null {
  if (spec.startsWith("@/platform/")) return `platform:${spec.slice("@/platform/".length).replace(/\.ts$/, "")}`;
  let rel: string | null = null;
  if (spec.startsWith("@/")) rel = spec.slice(2);
  else if (spec.startsWith(".")) rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return rel === null ? null : rel.replace(/\.(ts|tsx)$/, "");
}

const resolvesToBilling = (rel: string) =>
  BILLING_FILES.some((p) => (p.endsWith("/") ? `${rel}/`.startsWith(p) || rel.startsWith(p) : rel === p.replace(/\.ts$/, "")));

test("the dashboard and API reach billing only through billing()", () => {
  const breaches: string[] = [];
  for (const rel of sources(ROOT)) {
    // billing's own files, and the public stand-ins foldrun-admin replaces
    // (a hosted checkout holds the real ones there, importing billing).
    if (isBilling(rel) || rel in STUBS) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const imp of importsOf(text)) {
      const to = target(rel, imp.module);
      if (!to) continue;
      if (to.startsWith("platform:")) {
        const mod = to.slice("platform:".length);
        if (PRIVATE.has(mod)) {
          breaches.push(`${rel} imports @/platform/${mod}`);
        }
      } else if (resolvesToBilling(to)) {
        breaches.push(`${rel} imports ${imp.module}, which is billing's`);
      }
    }
  }
  assert.deepEqual(breaches, [], `go through billing() from @/platform/billing instead:\n${breaches.join("\n")}`);
});

test("billing's paths are all here or all gone, so the list cannot rot", () => {
  const present = BILLING_FILES.filter((p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(present.length === 0 || present.length === BILLING_FILES.length, `missing: ${BILLING_FILES.filter((p) => !present.includes(p)).join(", ")}`);
});
