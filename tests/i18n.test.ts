// The dashboard's words live in messages/<locale>/*.json, not in the code
// (owner, 17 Nov 2026: "the whole platform to be moved to language files and
// for now only english, later we can add persian"). This file holds that:
//
// - every message compiles as ICU once its {@term.form} references are
//   expanded, and none is left unexpanded;
// - every $t("…") key the code names is in the catalog, and every key in the
//   catalog is named somewhere (no dead sentences for a translator to do);
// - the ratchet: text still written in code (tests/i18n-baseline.json) may
//   only shrink. New text goes through $t(); `node scripts/i18n-scan.mjs
//   --baseline` rewrites the file after moving some, and refuses to add.
//
//   node --import ./tests/register.mjs --test tests/i18n.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse } from "@formatjs/icu-messageformat-parser";
import { MESSAGES, expandTerms, $t, DIR, LOCALE } from "@/i18n";
import { BASELINE, WEB, census, dashboardFiles, fingerprint, hardcoded } from "../scripts/i18n-scan.mjs";

type Tree = { [k: string]: string | Tree };
function leaves(t: Tree, at = ""): [string, string][] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[at + k, v] as [string, string]] : leaves(v, `${at}${k}.`)));
}
const ALL = leaves(MESSAGES as unknown as Tree);

test("English is the locale, left to right", () => {
  assert.equal(LOCALE, "en");
  assert.equal(DIR, "ltr");
});

test("every message compiles as ICU, with every term expanded", () => {
  assert.ok(ALL.length > 0);
  for (const [key, msg] of ALL) {
    assert.ok(!/\{@/.test(msg), `${key}: a term reference was not expanded: ${msg}`);
    assert.doesNotThrow(() => parse(msg), `${key}: not a valid ICU message: ${msg}`);
  }
});

test("a term is defined once and reaches every sentence that names it", () => {
  const out = expandTerms({ a: "Delete this {@workspace.one}?", b: { c: "All {@workspace.other}" } }, { workspace: { one: "project", other: "projects" } });
  assert.deepEqual(out, { a: "Delete this project?", b: { c: "All projects" } });
  assert.throws(() => expandTerms({ a: "{@nope.one}" }, {}), /unknown term/);
  assert.throws(() => expandTerms({ a: "{@workspace.few}" }, { workspace: { one: "x" } }), /no form "few"/);
  // ICU syntax in a term is quoted, so a term can never break a message.
  assert.equal(expandTerms({ a: "{@t.one}" }, { t: { one: "a{b}" } }).a, "'a{b}'");
});

test("the terms read as the product names them", () => {
  assert.equal($t("common.workspaceOne"), "project");
  assert.equal($t("common.workspaceOther"), "projects");
  assert.equal($t("settings.keys.keyOpensScoped", { n: 1 }), "The key will open the 1 project you can open, at the role you pick — never above your own.");
  assert.equal($t("settings.keys.keyOpensScoped", { n: 3 }), "The key will open the 3 projects you can open, at the role you pick — never above your own.");
});

test("every key the code names is in the catalog, and every catalog key is used", () => {
  const known = new Set(ALL.map(([k]) => k));
  const used = new Set<string>();
  for (const f of dashboardFiles()) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    for (const m of src.matchAll(/\$t\(\s*"([^"]+)"/g)) {
      used.add(m[1]);
      assert.ok(known.has(m[1]), `${f}: $t("${m[1]}") is not in messages/en`);
    }
    assert.ok(!/\$t\(\s*[`'][^"]/.test(src), `${f}: $t() takes a key written in double quotes, so this test can see it`);
  }
  const dead = [...known].filter((k) => !used.has(k));
  assert.deepEqual(dead, [], `keys no code uses — remove them: ${dead.join(", ")}`);
});

test("text written in code only shrinks: new text goes through $t()", () => {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Record<string, Record<string, number>>;
  const now = census() as Record<string, Record<string, number>>;
  const added: string[] = [];
  for (const [f, counts] of Object.entries(now)) {
    for (const [fp, n] of Object.entries(counts)) {
      if (n > (base[f]?.[fp] ?? 0)) {
        const where = (hardcoded(f) as { text: string; line: number }[]).find((h) => fingerprint(h.text) === fp);
        added.push(`${f}:${where?.line} "${where?.text.slice(0, 80)}"`);
      }
    }
  }
  assert.deepEqual(added, [], `text added in code instead of messages/en — put it in a language file and use $t():\n${added.join("\n")}`);
});
