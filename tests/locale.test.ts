// One install, a language per request (i18n/index.ts, server/locale.ts).
// What holds it together is checked here:
//
// - no sentence is made when a file is imported, and every page awaits the
//   language before it writes (scripts/i18n-import-time.mjs);
// - a word table built with localized() reads as the table, in the language
//   of whoever is reading;
// - Persian only ever replaces an English sentence that exists, with the same
//   {values} and <tags> in it.
//
//   node --import ./tests/register.mjs --test tests/locale.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { $t, MESSAGES, currentDir, currentLocale, expandTerms, localized, localizedList } from "@/i18n";
import { CATALOG_FA, TERMS_FA } from "@/i18n/persian";
import { localeForHost } from "@/server/locale-host";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
const ROOT = path.resolve(import.meta.dirname, "..");
import { importTimeCalls, pagesNotAwaiting } from "../scripts/i18n-import-time.mjs";

/** The browser's side of currentLocale(): the document's own language. */
function asBrowser<T>(lang: string, run: () => T): T {
  const g = globalThis as { document?: unknown };
  g.document = { documentElement: { lang } };
  try {
    return run();
  } finally {
    delete g.document;
  }
}

test("no sentence is made at import, and every page awaits the language", () => {
  assert.deepEqual(importTimeCalls(), []);
  assert.deepEqual(pagesNotAwaiting(), []);
});

test("the checker sees what it is for", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-locale-"));
  const write = (name: string, text: string) => {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  const table = write("table.ts", 'const A = { a: $t("x.y") };\nconst B = localized(() => ({ a: $t("x.y") }));\nexport const title = () => $t("x.y");\n');
  assert.equal(importTimeCalls([table]).length, 1);
  const eager = write("eager.ts", 'const ROWS = ["a"].map((k) => $t("x." + k));\nconst NOW = (() => $t("x.y"))();\nconst LATER = memo(function Row() { return $t("x.y"); });\nfunction f() { return ["a"].map(() => $t("x.y")); }\n');
  assert.equal(importTimeCalls([eager]).length, 2);
  const sync = write("a/page.tsx", "export default function Page() {\n  return null;\n}\n");
  const late = write("b/page.tsx", "export default async function Page() {\n  const x = 1;\n  await requestLocale();\n  return x;\n}\n");
  const meta = write("c/page.tsx", 'export async function generateMetadata() {\n  return { title: "x" };\n}\nexport default async function Page() {\n  await requestLocale();\n  return null;\n}\n');
  const good = write("d/page.tsx", "export async function generateMetadata() {\n  await requestLocale();\n  return {};\n}\nexport default async function Page() {\n  const locale = await requestLocale();\n  return locale;\n}\n");
  const client = write("e/page.tsx", '"use client";\nexport default function Page() {\n  return null;\n}\n');
  assert.equal(pagesNotAwaiting([sync]).length, 1);
  assert.equal(pagesNotAwaiting([late]).length, 1);
  assert.equal(pagesNotAwaiting([meta]).length, 1);
  assert.deepEqual(pagesNotAwaiting([good]), []);
  assert.deepEqual(pagesNotAwaiting([client]), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("outside a request the language is English", () => {
  assert.equal(currentLocale(), "en");
  assert.equal(currentDir(), "ltr");
  assert.equal($t("auth.login-page.signIn"), "Sign in");
});

test("in the browser the language is the document's", () => {
  asBrowser("fa", () => {
    assert.equal(currentLocale(), "fa");
    assert.equal(currentDir(), "rtl");
    assert.equal($t("auth.login-page.signIn"), "ورود");
  });
  asBrowser("en", () => assert.equal($t("auth.login-page.signIn"), "Sign in"));
  asBrowser("de", () => assert.equal(currentLocale(), "en"));
});

test("localized(): a table reads as itself, in the reader's language", () => {
  let built = 0;
  const NEVER_READ = localizedList(() => { built++; return [$t("auth.login-page.signIn")]; });
  assert.equal(built, 0, "nothing is built until it is read");
  void NEVER_READ;
  const TABS = localizedList(() => {
    built++;
    return [{ key: "in", label: $t("auth.login-page.signIn") }, { key: "up", label: $t("auth.signup-page.createAccount") }];
  });
  const LABEL = localized((): Record<string, string> => ({ in: $t("auth.login-page.signIn") }));

  assert.ok(Array.isArray(TABS));
  assert.equal(TABS.length, 2);
  assert.deepEqual(TABS.map((t) => t.label), ["Sign in", "Create account"]);
  assert.deepEqual([...TABS].map((t) => t.key), ["in", "up"]);
  assert.equal(TABS.find((t) => t.key === "in")?.label, "Sign in");
  assert.equal(JSON.stringify(TABS), '[{"key":"in","label":"Sign in"},{"key":"up","label":"Create account"}]');
  assert.equal(LABEL.in, "Sign in");
  assert.equal(LABEL.missing, undefined);
  assert.ok("in" in LABEL);
  assert.deepEqual(Object.keys(LABEL), ["in"]);
  assert.deepEqual(Object.entries(LABEL), [["in", "Sign in"]]);
  assert.deepEqual({ ...LABEL }, { in: "Sign in" });
  assert.equal(Object.getPrototypeOf(LABEL), Object.prototype);

  asBrowser("fa", () => {
    assert.equal(TABS[0].label, "ورود");
    assert.equal(LABEL.in, "ورود");
    assert.deepEqual(Object.values(LABEL), ["ورود"]);
  });
  assert.equal(TABS[0].label, "Sign in");

  // Built on first read, once per language, and the same table each time.
  assert.equal(built, 2);
  const before = built;
  assert.equal(TABS[0], TABS[0]);
  asBrowser("fa", () => assert.equal(TABS[1], TABS[1]));
  assert.equal(built, before);

  // A function kept in a table is the same function on every read.
  const fn = () => 1;
  const WITH_FN = localized(() => ({ label: $t("auth.login-page.signIn"), fn }));
  assert.equal(WITH_FN.fn, fn);
  assert.deepEqual(TABS.filter((t) => t.key === "up").map((t) => t.label), ["Create account"]);
  assert.deepEqual(TABS.slice(1).length, 1);
  assert.equal(TABS.some((t) => t.key === "in"), true);
  assert.deepEqual(Object.fromEntries(TABS.map((t) => [t.key, t.label])), { in: "Sign in", up: "Create account" });

  // Nobody writes to a shared table.
  assert.throws(() => { (LABEL as Record<string, string>).in = "x"; }, TypeError);
});

type Tree = { [k: string]: string | Tree };
const MESSAGES_FA = expandTerms(CATALOG_FA as unknown as Tree, TERMS_FA) as Tree;
const leaves = (t: Tree, at = ""): [string, string][] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[at + k, v] as [string, string]] : leaves(v, `${at}${k}.`)));
/** The values and tags a message takes, read from its ICU syntax: `{n}`,
 *  `{n, plural, …}` and `<link>`, at any depth. The words inside a plural's
 *  branches are text, not values. */
function holes(msg: string): string[] {
  const names = new Set<string>();
  const walk = (parts: MessageFormatElement[]) => {
    for (const el of parts) {
      if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
      names.add(el.type === TYPE.tag ? `<${el.value}>` : el.value);
      if (el.type === TYPE.tag) walk(el.children);
      if (el.type === TYPE.plural || el.type === TYPE.select) for (const o of Object.values(el.options)) walk(o.value);
    }
  };
  walk(parse(msg));
  return [...names].sort();
}

test("Persian replaces only sentences English has, with the same values", () => {
  const english = new Map(leaves(MESSAGES as unknown as Tree));
  for (const [key, fa] of leaves(MESSAGES_FA)) {
    const en = english.get(key);
    assert.ok(en !== undefined, `${key}: Persian for a sentence English does not have`);
    assert.deepEqual(holes(fa), holes(en), `${key}: the Persian sentence takes other values than the English one`);
  }
});

test("Persian's sentences are in no English page's download", () => {
  // i18n/index.ts is in every browser bundle; only these may bring
  // the Persian catalog (see i18n/persian.ts).
  const allowed = new Set(["i18n/persian.ts", "i18n/persian-provider.tsx", "server/locale.ts", "app/layout.tsx"]);
  // The provider asks for them with import(), never a static import: the
  // browser is sent every file a layout names.
  assert.match(fs.readFileSync(path.join(ROOT, "i18n/persian-provider.tsx"), "utf8"), /import\("\.\/persian"\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "i18n/persian-provider.tsx"), "utf8"), /^import .*["']\.\/persian["']/m);
  // …and only for a Persian document (or on the server): every call of the
  // loader outside its own definition is behind that check or inside the
  // Persian branch.
  const provider = fs.readFileSync(path.join(ROOT, "i18n/persian-provider.tsx"), "utf8");
  const calls = provider.split("\n").filter((l) => /loadPersian\(\)/.test(l) && !/^function loadPersian/.test(l));
  assert.deepEqual(calls.map((l) => l.trim()), [
    'if (typeof document === "undefined" || document.documentElement.lang === "fa") void loadPersian();',
    "if (!ready) use(loadPersian());",
  ]);
  assert.match(provider, /if \(locale === "fa"\) return <Persian>/);
  const files = execFileSync("git", ["ls-files", "app", "components", "i18n", "server", "proxy.ts"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /\.tsx?$/.test(f));
  const bad = files.filter((f) => !allowed.has(f) && /from "@\/messages\/fa|["']@\/i18n\/persian|["']\.\/persian/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(bad, []);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "i18n/index.ts"), "utf8"), /^import .*messages\/fa/m);
});

test("parity reads a message's syntax, not its words", () => {
  assert.deepEqual(holes("{n, plural, one {# device} other {# devices}} for <b>{who}</b>"), ["<b>", "n", "who"]);
  assert.deepEqual(holes("{n, plural, one {# دستگاه} other {# دستگاه}} برای <b>{who}</b>"), ["<b>", "n", "who"]);
  assert.throws(() => holes("{n, plural, one {x}"));
});

test("a sentence Persian lacks is the English one, by English rules", (t) => {
  // Chosen from what is untranslated today, so translating a sentence never
  // breaks this; with everything translated there is nothing left to fall back.
  const persian = new Set(leaves(MESSAGES_FA).map(([k]) => k));
  const untranslated = leaves(MESSAGES as unknown as Tree).filter(([k]) => !persian.has(k));
  const plain = untranslated.find(([, m]) => !/[{<]/.test(m));
  // Persian counts 0 as "one"; an English sentence must still say "0 cases".
  const plural = untranslated.find(([, m]) => /^\{n, plural, one \{[^{}]*\} other \{[^{}]*\}\}$/.test(m));
  if (!plain && !plural) return t.skip("every sentence is translated");
  if (plain) asBrowser("fa", () => assert.equal($t(plain[0]), plain[1]));
  if (plural) {
    const english = $t(plural[0], { n: 0 });
    asBrowser("fa", () => assert.equal($t(plural[0], { n: 0 }), english));
    assert.notEqual(english, $t(plural[0], { n: 1 }));
  }
});

test("the language follows the host's name, and the choice only on a Persian host", () => {
  const fa = "dash.foldrun.ir, fa.localhost:3977";
  assert.equal(localeForHost("dash.foldrun.ir", undefined, fa), "fa");
  assert.equal(localeForHost("dash.foldrun.ir:8443", undefined, fa), "fa");
  assert.equal(localeForHost("DASH.Foldrun.IR.", undefined, fa), "fa");
  assert.equal(localeForHost("fa.localhost", undefined, fa), "fa");
  assert.equal(localeForHost("dash.foldrun.ir", "en", fa), "en");
  assert.equal(localeForHost("dash.foldrun.ir", "de", fa), "fa");
  assert.equal(localeForHost("dash.foldrun.io", undefined, fa), "en");
  assert.equal(localeForHost("dash.foldrun.io", "fa", fa), "en");
  assert.equal(localeForHost("evil-dash.foldrun.ir.example.com", undefined, fa), "en");
  assert.equal(localeForHost(null, undefined, fa), "en");
  assert.equal(localeForHost("dash.foldrun.ir", undefined, ""), "en");
  assert.equal(localeForHost("dash.foldrun.ir", undefined, undefined), "en");
});
