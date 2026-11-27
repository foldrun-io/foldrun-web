// The dashboard's words live in language files (owner, 17 Nov 2026: "the
// whole platform to be moved to language files and for now only english,
// later we can add persian").
//
//   messages/<locale>/*.json   every sentence the dashboard shows, by area
//   messages/<locale>/terms.json   the product's nouns, defined once
//
// A sentence names a term as {@workspace.one} (also .other, .One, .Other —
// the four English forms). The terms are expanded into the sentences once,
// when the catalog loads and before any message is parsed, so renaming a
// noun is one edit in terms.json and no sentence is assembled in code.
// Another language brings its own terms AND its own full sentences: Persian
// grammar is not English with the nouns swapped.
//
// Use: `$t("settings.keys.title")`, `$t("runs.page.count", { n })` — ICU
// messages (plurals, selects, numbers), the same call in server components,
// client components and plain modules. A sentence with markup inside it is
// one message with tags, so a translator can move the markup with the words:
// `$rich("limits.page.everyCap", { code: (chunks) => <code>{chunks}</code> })`
// for "Every cap here is the <code>budget:</code> line…". English is the only locale for now;
// `dir` is here so a right-to-left language is one switch later.

import * as React from "react";
import type { ReactNode } from "react";
import { createTranslator } from "use-intl/core";
import { CATALOG } from "@/messages/en";
import TERMS from "@/messages/en/terms.json" with { type: "json" };
import { LocaleContext, type Locale } from "./locale-context";

export type { Locale };

// ---- which language this call is in ---------------------------------------
//
// `$t` is one synchronous function imported everywhere, so it has to find
// the request's language by itself:
//
//   server components   React's per-request cache holds it; server/locale.ts
//                       puts it there (`await requestLocale()`), from the
//                       header only the proxy writes. cache() follows a
//                       request across its awaits.
//   client components   in the browser, the document's own language
//                       (`<html lang>`, written by the server), which is
//                       right in a render, an event handler or a timer
//                       alike. While the server renders them, the context
//                       the root layout provides, read with use(), which
//                       React allows from a plain function during a render.
//   outside a render    on the server, English: a module-level call runs
//                       once, at import, and must not translate there
//                       (tests/i18n.test.ts refuses one).
//
// Changing language reloads the page: the document's language is what the
// browser reads, and no sentence already drawn is left in the old one.

/** True in the server-components graph, where React has no createContext. */
const RSC = typeof (React as { createContext?: unknown }).createContext !== "function";

const RENDER_STATE = (React as unknown as Record<string, { H?: unknown } | undefined>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const requestStore = React.cache((): { locale?: Locale } => ({}));

/** server/locale.ts only: this request's language. */
export function setRequestLocale(locale: Locale): void {
  requestStore().locale = locale;
}

export function currentLocale(): Locale {
  if (RSC) return requestStore().locale ?? "en";
  if (typeof document !== "undefined") return document.documentElement.lang === "fa" ? "fa" : "en";
  // Outside a render (a script, a test, a job) there is no context to read.
  // React's development build logs "Invalid hook call" before it throws, so
  // ask first where it says; if that ever moves, the catch below still answers.
  if (RENDER_STATE && RENDER_STATE.H === null) return "en";
  try {
    // Not a hook's usual place, on purpose: `$t` is a plain function called
    // from 132 client components, and this branch runs only while the server
    // renders one. use(Context) never suspends; outside a render it throws,
    // which is the module-level case answered below.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return React.use(LocaleContext);
  } catch {
    return "en";
  }
}

export function currentDir(): "ltr" | "rtl" {
  return currentLocale() === "fa" ? "rtl" : "ltr";
}

/**
 * A table of words written at the top of a file: `const LABEL = localized(()
 * => ({ open: $t("…") }))`, or for a list `const TABS = localizedList(() =>
 * [{ key: "mine", label: $t("…") }])`. A file is read once, before any
 * request, so a sentence translated there would be English for everybody.
 * These build the table once per language, the first time it is read (never
 * at import), and hand back something that reads as the table itself:
 * `TABS.map(…)`, `LABEL[key]`, `Object.entries(LABEL)` all see the current
 * language's copy. A single sentence is a function instead.
 */
export function localized<T extends object>(build: () => T): T {
  return standIn({} as T, build);
}

/** localized() for a list: the stand-in is an array, so Array.isArray and
 *  React's check of what may cross to the browser answer as for the list. */
export function localizedList<T extends readonly unknown[]>(build: () => T): T {
  return standIn([] as unknown as T, build);
}

function standIn<T extends object>(shape: T, build: () => T): T {
  const made = new Map<Locale, T>();
  const now = (): T => {
    const locale = currentLocale();
    let value = made.get(locale);
    if (value) return value;
    value = build();
    // Persian words not handed over yet: the table is English for now, so it
    // is not kept as the Persian one.
    if (locale !== "fa" || PERSIAN) made.set(locale, value);
    return value;
  };
  return new Proxy(shape, {
    // Methods (`map`, `find`) come back as they are and run on the stand-in,
    // reading each element through here: nothing is bound, so a component or
    // function kept in a table is the same one on every read.
    get: (_s, key) => Reflect.get(now(), key),
    has: (_s, key) => Reflect.has(now(), key),
    ownKeys: () => Reflect.ownKeys(now()),
    getOwnPropertyDescriptor: (_s, key) => {
      const d = Reflect.getOwnPropertyDescriptor(now(), key);
      // A stand-in may only report a fixed property it has itself (an array's length).
      return d && key !== "length" ? { ...d, configurable: true } : d;
    },
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
  });
}

/** Kept for callers that format with the language: the English default. */
export const LOCALE = "en";
export const DIR: "ltr" | "rtl" = "ltr";

type Forms = Record<string, string>;
type Tree = { [key: string]: string | Tree };

/** ICU treats { } # | and a quote before them as syntax: a term is plain
 *  text, so quote what would be read as syntax. */
function icuLiteral(s: string): string {
  return /[{}#|]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

const REF = /\{@([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

/** Every {@term.form} in the tree, replaced; an unknown term or form throws,
 *  so a typo fails the build and the tests instead of reaching a page. */
export function expandTerms(tree: Tree, terms: Record<string, Forms>, at = ""): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(tree)) {
    const path = at ? `${at}.${k}` : k;
    if (typeof v === "string") {
      out[k] = v.replace(REF, (_m, term: string, form: string) => {
        const forms = terms[term];
        if (!forms) throw new Error(`${path}: unknown term {@${term}.${form}}`);
        const word = forms[form];
        if (word === undefined) throw new Error(`${path}: term ${term} has no form "${form}" (has ${Object.keys(forms).join(", ")})`);
        return icuLiteral(word);
      });
    } else out[k] = expandTerms(v, terms, path);
  }
  return out;
}

export const MESSAGES = expandTerms(CATALOG as Tree, TERMS as Record<string, Forms>) as typeof CATALOG;

/** `over` laid on `base`: a key the second lacks keeps the first's sentence. */
function layOver(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = typeof v === "string" || typeof b !== "object" ? v : layOver(b, v);
  }
  return out;
}

const ENGLISH = createTranslator({ locale: "en", messages: MESSAGES });
// Persian holds only its own sentences, laid over English so every key
// resolves; which keys are really Persian is kept beside it.
// Persian holds only its own sentences, laid over English so every key
// resolves; which keys are really Persian is kept beside it. Its catalog is
// not imported here: this file is in every page's browser bundle, and an
// English page must not download Persian. i18n/persian.ts hands it over
// (registerPersian) where a Persian page is made: on the server for every
// request (server/locale.ts), in the browser by the provider the root layout
// renders around a Persian page only (i18n/persian-provider.tsx).
let PERSIAN: typeof ENGLISH | null = null;
let IN_PERSIAN = new Set<string>();

/** i18n/persian.ts only: Persian's sentences and nouns. */
export function registerPersian(catalog: Tree, terms: Record<string, Forms>): void {
  // Called once per load of persian.ts; a second call (an edited file in
  // development) replaces the first.
  const own = expandTerms(catalog, terms);
  IN_PERSIAN = new Set(keysOf(own));
  PERSIAN = createTranslator({ locale: "fa", messages: layOver(MESSAGES as Tree, own) as typeof MESSAGES });
}

function keysOf(t: Tree, at = ""): string[] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [at + k] : keysOf(v, `${at}${k}.`)));
}

/** The translator for one key: Persian only for a sentence Persian has. One
 *  it lacks is written by the English translator, so its plurals and numbers
 *  follow English rules ("0 cases"), not Persian rules on English words. */
function translatorFor(key: string): typeof ENGLISH {
  return currentLocale() === "fa" && PERSIAN && IN_PERSIAN.has(key) ? PERSIAN : ENGLISH;
}

type Values = Record<string, string | number | Date>;

/** One sentence of the dashboard, by key. */
export function $t(key: string, values?: Values): string {
  return (translatorFor(key) as unknown as (k: string, v?: Values) => string)(key, values);
}

type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;

/** One sentence with markup in it: each <tag> in the message is drawn by the
 *  function of the same name (use-intl keys the elements). */
export function $rich(key: string, values: RichValues): ReactNode {
  return (translatorFor(key).rich as unknown as (k: string, v: RichValues) => ReactNode)(key, values);
}

/** An element placed inside a sentence as-is: `<localTime></localTime>` in the
 *  message, `localTime: $el(<LocalTime iso={at} />)` in the code. Built where
 *  it stood, so the page's own narrowing and values still apply. */
export function $el(node: ReactNode): () => ReactNode {
  return () => node;
}
